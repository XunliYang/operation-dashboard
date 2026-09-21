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
from collector.github.client import GitHubClient, RateLimitExceeded
from collector.github.ratelimit import TokenPool, seconds_until_reset
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


def _finish_failed(conn, run_id: int, client: GitHubClient, error: str) -> None:
    """记录一次失败采集；附带客户端最近一次响应的配额余量（可能为 0）。"""
    remaining = client.rate_limit.remaining if client.rate_limit else None
    db.finish_collect_run(
        conn,
        run_id=run_id,
        status="failed",
        rate_limit_remaining=remaining,
        error=error,
    )
    conn.commit()


def _reset_eta(client: GitHubClient) -> str | None:
    """配额重置还需等待的秒数（无 reset 头时返回 None）。"""
    state = client.rate_limit
    if state is None or state.reset_epoch is None:
        return None
    wait = seconds_until_reset(state.reset_epoch)
    return None if wait is None else f"{wait:.0f}s"


def collect_repos(
    repos: list[dict],
    client: GitHubClient,
    conn,
    *,
    backfill_days: int,
    job: str = "github_incremental",
) -> dict[str, int]:
    """逐仓库跑一轮增量采集，逐仓库记一条 collect_run。

    配额耗尽（`RateLimitExceeded`）时中断本轮：之后每个仓库的请求注定 403，
    记录余量与 reset 时间后停下，避免在配额窗口内刷屏失败记录。返回
    `{collected, failed, skipped}` 统计。
    """
    collector = GitHubCollector(client, conn, backfill_days=backfill_days)
    total = len(repos)
    collected = 0
    failed = 0

    for idx, repo in enumerate(repos):
        full_name = repo["repo"]
        owner, name = full_name.split("/", 1)
        run_id = db.start_collect_run(conn, job=job, repo_id=None)
        conn.commit()  # 'running' 行先落库，采集与收尾各自独立事务
        try:
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
            collected += 1
            logger.info("collected {}: {}", full_name, result)
        except RateLimitExceeded:
            conn.rollback()
            _finish_failed(conn, run_id, client, "GitHub 配额耗尽（X-RateLimit-Remaining=0）")
            failed += 1
            skipped = total - idx - 1
            eta = _reset_eta(client)
            logger.warning(
                "GitHub 配额耗尽，中断本轮：剩余 {} 个仓库跳过{}",
                skipped,
                f"（配额约 {eta} 后重置）" if eta else "",
            )
            break
        except Exception as exc:  # noqa: BLE001 — 单仓库失败不影响其余仓库
            conn.rollback()
            _finish_failed(conn, run_id, client, str(exc)[:1000])
            failed += 1
            logger.exception("collection failed for {}: {}", full_name, exc)

    return {"collected": collected, "failed": failed, "skipped": total - collected - failed}


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
        stats = collect_repos(repos, client, conn, backfill_days=settings.backfill_days)
        if stats["skipped"]:
            logger.warning("本轮因配额耗尽跳过 {} 个仓库", stats["skipped"])


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