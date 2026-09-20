"""调度器装配：不真正启动，只校验 job 注册结果。

注意：`build_scheduler` 只做装配，不 `start()`；未启动的调度器调用 `shutdown()`
会抛 `SchedulerNotRunningError`，因此这里不做 shutdown 清理。
"""

from collector.config import CollectorSettings
from collector.main import build_scheduler


def _settings() -> CollectorSettings:
    return CollectorSettings(redis_url="", timezone="Asia/Shanghai")


def test_scheduler_registers_enabled_jobs_only():
    scheduler = build_scheduler(_settings())
    job_ids = {job.id for job in scheduler.get_jobs()}

    assert "collect_github_activity" in job_ids
    assert "recompute_health_scores" in job_ids
    # Phase 0 该 job enabled=False，不应注册
    assert "collect_sentiment" not in job_ids


def test_scheduler_is_not_running_before_start():
    scheduler = build_scheduler(_settings())
    assert scheduler.running is False


def test_registered_jobs_carry_expected_triggers():
    scheduler = build_scheduler(_settings())
    for job in scheduler.get_jobs():
        assert job.trigger.interval.total_seconds() > 0
        assert job.max_instances == 1
        assert job.coalesce is True
