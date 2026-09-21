"""Job 注册表与实现：GitHub 增量采集。

- `collect_github_activity`：定时增量兜底（Webhook 是实时主通道）。
- 健康分由 API 在读取时惰性计算并持久化，collector 不重复实现评分。
- 舆情采集 Phase 3 启用。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from loguru import logger

import collector.db as db
from collector.collector import GitHubCollector
from collector.config import get_settings
from collector.github.client import GitHubClient
from collector.github.ratelimit import TokenPool
from collector.lock import Lock
from collector.tracked import load_tracked_repos


@dataclass(frozen=True)
class JobSpec:
    name: str
    func: Callable[[], None]
    interval_seconds: int
    description: str = ""
    enabled: bool = True
    tags: list[str] = field(default_factory=list)


def collect_github_activity() -> None:
    """对 tracked_repos.yaml 里的每个仓库跑一次增量采集，逐仓库记 collect_run。"""
    settings = get_settings()
    tokens = TokenPool(settings.github_token_list())
    if not tokens:
        logger.warning("未配置 GitHub token，按未认证配额（60/h）采集")

    client = GitHubClient(
        token_pool=tokens,
        base_url=settings.github_api_base,
        rate_limit_threshold=settings.rate_limit_threshold,
        throttle_delay_seconds=settings.throttle_delay_seconds,
        max_retries=settings.max_retries,
    )

    repos = load_tracked_repos(settings.config_dir)
    if not repos:
        logger.warning("tracked_repos.yaml 无启用的仓库，跳过采集")
        return

    with db.connect_db(settings.database_url) as conn:
        collector = GitHubCollector(client, conn, backfill_days=settings.backfill_days)
        for repo in repos:
            full_name = repo["repo"]
            owner, name = full_name.split("/", 1)
            try:
                run_id = db.start_collect_run(conn, job="github_incremental", repo_id=None)
                result = collector.collect_repo(owner, name)
                db.finish_collect_run(
                    conn,
                    run_id=run_id,
                    status="success",
                    rate_limit_remaining=result.get("rate_limit_remaining"),
                )
                if result.get("repo_id"):
                    conn.execute(
                        "UPDATE collect_run SET repo_id=%s WHERE run_id=%s",
                        (result["repo_id"], run_id),
                    )
                conn.commit()
                logger.info("collected {}: {}", full_name, result)
            except Exception as exc:  # noqa: BLE001 — 单仓库失败不影响其余仓库
                conn.rollback()
                try:
                    run_id = db.start_collect_run(conn, job="github_incremental", repo_id=None)
                    db.finish_collect_run(conn, run_id=run_id, status="failed", error=str(exc)[:1000])
                    conn.commit()
                except Exception:  # noqa: BLE001
                    conn.rollback()
                    logger.exception("记录 collect_run 失败也异常，忽略")
                logger.exception("collection failed for {}: {}", full_name, exc)


def collect_sentiment() -> None:
    """Phase 3 实现：对接 sentiment-monitor 采集结果。"""
    logger.info("[stub] collect_sentiment: 本阶段为空实现")


def build_registry() -> list[JobSpec]:
    """返回全部 job 定义。新增 job 只需在此登记。"""
    return [
        JobSpec(
            name="collect_github_activity",
            func=collect_github_activity,
            interval_seconds=600,
            description="采集 GitHub 活跃数据（增量兜底）",
            tags=["github"],
        ),
        JobSpec(
            name="collect_sentiment",
            func=collect_sentiment,
            interval_seconds=900,
            description="采集舆情数据",
            tags=["sentiment"],
            enabled=False,  # Phase 3 再启用
        ),
    ]


def run_job_with_lock(spec: JobSpec, lock: Lock, ttl_seconds: int) -> bool:
    """在分布式锁保护下执行一个 job。

    返回 True 表示本次真正执行，False 表示因锁竞争被跳过。
    异常被捕获并记录，不向外抛出——避免单个 job 失败拖垮调度器。
    """
    if not lock.acquire(spec.name, ttl_seconds):
        logger.info("job skipped (locked): {}", spec.name)
        return False
    try:
        spec.func()
        logger.info("job done: {}", spec.name)
        return True
    except Exception as exc:  # noqa: BLE001 — 调度器不能被单个 job 拖垮
        logger.exception("job failed: {} — {}", spec.name, exc)
        return False
    finally:
        lock.release(spec.name)