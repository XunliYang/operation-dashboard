"""jobs 注册表与锁行为。"""

from collector.jobs import JobSpec, build_registry, run_job_with_lock
from collector.lock import NullLock


class RecordingLock:
    def __init__(self, grant: bool = True) -> None:
        self.grant = grant
        self.acquired: list[str] = []
        self.released: list[str] = []

    def acquire(self, key: str, ttl_seconds: int) -> bool:
        if not self.grant:
            return False
        self.acquired.append(key)
        return True

    def release(self, key: str) -> None:
        self.released.append(key)


def test_registry_has_expected_jobs():
    names = {spec.name for spec in build_registry()}
    assert {"collect_github_activity", "recompute_health_scores"} <= names


def test_sentiment_job_disabled_in_phase_0():
    specs = {spec.name: spec for spec in build_registry()}
    assert specs["collect_sentiment"].enabled is False


def test_every_job_has_positive_interval():
    assert all(spec.interval_seconds > 0 for spec in build_registry())


def test_run_job_executes_and_releases_lock():
    calls = []
    lock = RecordingLock()
    spec = JobSpec(name="probe", func=lambda: calls.append(1), interval_seconds=60)

    assert run_job_with_lock(spec, lock, ttl_seconds=30) is True
    assert calls == [1]
    assert lock.acquired == ["probe"]
    assert lock.released == ["probe"]


def test_run_job_skips_when_lock_not_acquired():
    calls = []
    lock = RecordingLock(grant=False)
    spec = JobSpec(name="probe", func=lambda: calls.append(1), interval_seconds=60)

    assert run_job_with_lock(spec, lock, ttl_seconds=30) is False
    assert calls == []
    assert lock.released == []


def test_run_job_swallows_exception_and_releases_lock():
    def boom() -> None:
        raise RuntimeError("boom")

    lock = RecordingLock()
    spec = JobSpec(name="boom", func=boom, interval_seconds=60)

    assert run_job_with_lock(spec, lock, ttl_seconds=30) is False
    assert lock.released == ["boom"]


def test_null_lock_always_grants():
    lock = NullLock()
    assert lock.acquire("k", 10) is True
    lock.release("k")  # 不抛异常
