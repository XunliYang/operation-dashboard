"""Job 注册表：把 job 名映射到可调用对象与默认调度。

Phase 0 的 job 体都是空实现（只打日志），用于验证调度、锁与容错链路。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from loguru import logger

from collector.lock import Lock


@dataclass(frozen=True)
class JobSpec:
    name: str
    func: Callable[[], None]
    interval_seconds: int
    description: str = ""
    enabled: bool = True
    tags: list[str] = field(default_factory=list)


def collect_github_activity() -> None:
    """Phase 1 实现：拉取 tracked_repos 的 commit / issue / PR。"""
    logger.info("[stub] collect_github_activity: 本阶段不接 GitHub API")


def recompute_health_scores() -> None:
    """Phase 1 实现：按 health_weights.yaml 重算仓库健康分。"""
    logger.info("[stub] recompute_health_scores: 本阶段为空实现")


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
            description="采集 GitHub 活跃数据",
            tags=["github"],
        ),
        JobSpec(
            name="recompute_health_scores",
            func=recompute_health_scores,
            interval_seconds=1800,
            description="重算仓库健康分",
            tags=["metrics"],
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
