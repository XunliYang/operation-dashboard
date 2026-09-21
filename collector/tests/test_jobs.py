"""jobs 注册表与锁行为。"""

import time

import collector.jobs as jobs
from collector.github.client import RateLimitExceeded
from collector.github.ratelimit import RateLimitState
from collector.jobs import JobSpec, build_registry, collect_repos, run_job_with_lock
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
    assert "collect_github_activity" in names


def test_sentiment_job_disabled_in_phase_1():
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


class _FakeConn:
    """collect_repos 所需的最小连接桩：execute/commit/rollback 均可用。"""

    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    def execute(self, *args, **kwargs):
        return self

    def fetchone(self):
        return (1,)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class _FakeClient:
    def __init__(self, remaining: int = 0, reset_epoch: float | None = None) -> None:
        self.rate_limit = RateLimitState(limit=60, remaining=remaining, reset_epoch=reset_epoch)


class _FakeCollector:
    def __init__(self, client, conn, *, backfill_days: int) -> None:
        self.calls: list[str] = []
        self.raise_on: set[str] = set()
        self.exhausted_on: set[str] = set()

    def collect_repo(self, owner: str, name: str) -> dict:
        full = f"{owner}/{name}"
        self.calls.append(full)
        if full in self.exhausted_on:
            raise RateLimitExceeded(403, "X-RateLimit-Remaining exhausted")
        if full in self.raise_on:
            raise RuntimeError("boom")
        return {"repo_id": 123, "rate_limit_remaining": 3}


def _patch_db(monkeypatch, finishes):
    run_ids = iter(range(1, 100))
    monkeypatch.setattr(
        jobs.db, "start_collect_run", lambda conn, *, job, repo_id, **kw: next(run_ids)
    )
    monkeypatch.setattr(jobs.db, "finish_collect_run", lambda conn, **kw: finishes.append(kw))


def _repos() -> list[dict]:
    return [
        {"repo": "a/b1", "org": "o"},
        {"repo": "a/b2", "org": "o"},
        {"repo": "a/b3", "org": "o"},
    ]


def test_collect_repos_breaks_on_rate_limit_exhausted(monkeypatch):
    finishes: list[dict] = []
    _patch_db(monkeypatch, finishes)

    fake = _FakeCollector(None, None, backfill_days=90)
    fake.exhausted_on = {"a/b2"}
    monkeypatch.setattr(jobs, "GitHubCollector", lambda client, conn, *, backfill_days: fake)

    client = _FakeClient(remaining=0, reset_epoch=time.time() + 3600)
    conn = _FakeConn()
    stats = collect_repos(_repos(), client, conn, backfill_days=90)

    # b3 被跳过：配额耗尽后不再发起注定 403 的请求
    assert fake.calls == ["a/b1", "a/b2"]
    assert stats == {"collected": 1, "failed": 1, "skipped": 1}
    assert len(finishes) == 2
    assert finishes[0]["status"] == "success"
    assert finishes[0]["rate_limit_remaining"] == 3
    # 失败记录同样携带配额余量（0），不再留空
    assert finishes[1]["status"] == "failed"
    assert finishes[1]["rate_limit_remaining"] == 0


def test_collect_repos_records_remaining_on_generic_failure(monkeypatch):
    finishes: list[dict] = []
    _patch_db(monkeypatch, finishes)

    fake = _FakeCollector(None, None, backfill_days=90)
    fake.raise_on = {"a/b2"}
    monkeypatch.setattr(jobs, "GitHubCollector", lambda client, conn, *, backfill_days: fake)

    client = _FakeClient(remaining=7)
    conn = _FakeConn()
    stats = collect_repos(_repos(), client, conn, backfill_days=90)

    # 一般异常不中断：b3 继续采集
    assert fake.calls == ["a/b1", "a/b2", "a/b3"]
    assert stats == {"collected": 2, "failed": 1, "skipped": 0}
    failed = [f for f in finishes if f["status"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["rate_limit_remaining"] == 7
