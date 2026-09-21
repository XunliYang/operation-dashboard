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


# --- 定时兜底：逐仓库采集与配额治理 ---


class _FakeConn:
    """collect_repos / _drain_queued 所需的最小连接桩。"""

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


# --- P1-3 / LEOY-20：queued 消费 + full_backfill 区分 ---


class _Settings:
    config_dir = "config"


def test_drain_queued_advances_run_to_success_and_collects(monkeypatch):
    import collector.db as db
    from collector.jobs import _drain_queued

    calls: dict = {"collect": [], "running": [], "finished": []}

    class StubCollector:
        def collect_repo(self, owner, name, *, full_backfill=False):
            calls["collect"].append(f"{owner}/{name}")
            return {"rate_limit_remaining": 50}

    monkeypatch.setattr(db, "claim_queued_collect_runs", lambda conn: [(7, "github_incremental", 3)])
    monkeypatch.setattr(db, "repo_ref", lambda conn, repo_id: ("o", "n"))
    monkeypatch.setattr(
        db, "mark_collect_run_running", lambda conn, run_id: calls["running"].append(run_id)
    )
    monkeypatch.setattr(db, "finish_collect_run", _record_finish(calls))

    _drain_queued(_FakeConn(), StubCollector(), _Settings())

    assert calls["running"] == [7]
    assert calls["collect"] == ["o/n"]
    assert calls["finished"] == [(7, "success", None)]


def test_drain_queued_marks_failed_on_error(monkeypatch):
    import collector.db as db
    from collector.jobs import _drain_queued

    calls: dict = {"finished": []}

    class BoomCollector:
        def collect_repo(self, owner, name, *, full_backfill=False):
            raise RuntimeError("boom")

    monkeypatch.setattr(db, "claim_queued_collect_runs", lambda conn: [(9, "github_backfill", None)])
    monkeypatch.setattr(db, "mark_collect_run_running", lambda conn, run_id: None)
    monkeypatch.setattr(db, "finish_collect_run", _record_finish(calls))
    monkeypatch.setattr("collector.jobs.load_tracked_repos", lambda config_dir: [{"repo": "a/b"}])

    _drain_queued(_FakeConn(), BoomCollector(), _Settings())

    assert calls["finished"] == [(9, "failed", "boom")]


def test_collect_scope_none_collects_all_tracked_repos(monkeypatch):
    from collector.jobs import _collect_scope

    monkeypatch.setattr(
        "collector.jobs.load_tracked_repos", lambda config_dir: [{"repo": "a/b"}, {"repo": "c/d"}]
    )

    class Stub:
        def __init__(self):
            self.calls = []

        def collect_repo(self, owner, name, *, full_backfill=False):
            self.calls.append(f"{owner}/{name}")
            return {"rate_limit_remaining": 1}

    stub = Stub()
    result = _collect_scope(None, stub, _Settings(), None)
    assert stub.calls == ["a/b", "c/d"]
    assert result == {"rate_limit_remaining": 1}


def test_drain_queued_distinguishes_backfill_from_incremental(monkeypatch):
    """job 必须真正生效：github_backfill → full_backfill=True，反之 False。"""
    import collector.db as db
    from collector.jobs import _drain_queued

    collected: list[tuple[str, str, bool]] = []

    class StubCollector:
        def collect_repo(self, owner, name, *, full_backfill=False):
            collected.append((owner, name, full_backfill))
            return {"rate_limit_remaining": 50}

    monkeypatch.setattr(
        db,
        "claim_queued_collect_runs",
        lambda conn: [(1, "github_backfill", None), (2, "github_incremental", None)],
    )
    monkeypatch.setattr(db, "mark_collect_run_running", lambda conn, run_id: None)
    monkeypatch.setattr(db, "finish_collect_run", lambda conn, **k: None)
    monkeypatch.setattr("collector.jobs.load_tracked_repos", lambda config_dir: [{"repo": "a/b"}])

    _drain_queued(_FakeConn(), StubCollector(), _Settings())

    assert collected == [("a", "b", True), ("a", "b", False)]


def _record_finish(calls: dict):
    def finish(conn, run_id, status, rate_limit_remaining=None, error=None):
        calls["finished"].append((run_id, status, error))

    return finish
