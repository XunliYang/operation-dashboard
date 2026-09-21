"""调度器装配：把注册表中的 job 挂到 APScheduler。"""

from __future__ import annotations

from apscheduler.schedulers.blocking import BlockingScheduler
from loguru import logger

from collector.config import CollectorSettings, get_settings
from collector.jobs import build_registry, run_job_with_lock
from collector.lock import build_lock


def build_scheduler(settings: CollectorSettings | None = None) -> BlockingScheduler:
    settings = settings or get_settings()
    lock = build_lock(settings.redis_url, settings.lock_key_prefix)

    scheduler = BlockingScheduler(timezone=settings.timezone)

    for spec in build_registry():
        if not spec.enabled:
            logger.info("job disabled, skipped: {}", spec.name)
            continue
        scheduler.add_job(
            run_job_with_lock,
            trigger="interval",
            seconds=spec.interval_seconds,
            args=[spec, lock, settings.lock_ttl_seconds],
            id=spec.name,
            name=spec.description or spec.name,
            max_instances=1,
            coalesce=True,
            replace_existing=True,
        )
        logger.info("job registered: {} every {}s", spec.name, spec.interval_seconds)

    return scheduler


def main() -> None:
    import sys

    if "--run-once" in sys.argv:
        logger.info("collector run-once (github_incremental)")
        from collector.jobs import collect_github_activity

        collect_github_activity()
        logger.info("collector run-once done")
        return

    logger.info("collector starting (Webhook 优先 + 定时增量兜底)")
    scheduler = build_scheduler()
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("collector stopping")


if __name__ == "__main__":
    main()
