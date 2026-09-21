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


# --- P1-3：queued 请求消费（POST /admin/collect → 状态推进到终态并确有采集） ---


class _FakeConn:
    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass


class _Settings:
    config_dir = "config"


def test_drain_queued_advances_run_to_success_and_collects(monkeypatch):
    import collector.db as db
    from collector.jobs import _drain_queued

    calls: dict = {"collect": [], "running": [], "finished": []}

    class StubCollector:
        def collect_repo(self, owner, name):
            calls["collect"].append(f"{owner}/{name}")
            return {"rate_limit_remaining": 50}

    monkeypatch.setattr(db, "claim_queued_collect_runs", lambda conn: [(7, "github_incremental", 3)])
    monkeypatch.setattr(db, "repo_ref", lambda conn, repo_id: ("o", "n"))
    monkeypatch.setattr(db, "mark_collect_run_running",
                        lambda conn, run_id: calls["running"].append(run_id))
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
        def collect_repo(self, owner, name):
            raise RuntimeError("boom")

    monkeypatch.setattr(db, "claim_queued_collect_runs", lambda conn: [(9, "github_backfill", None)])
    monkeypatch.setattr(db, "mark_collect_run_running", lambda conn, run_id: None)
    monkeypatch.setattr(db, "finish_collect_run", _record_finish(calls))
    monkeypatch.setattr("collector.jobs.load_tracked_repos", lambda config_dir: [{"repo": "a/b"}])

    _drain_queued(_FakeConn(), BoomCollector(), _Settings())

    assert calls["finished"] == [(9, "failed", "boom")]


def test_collect_scope_none_collects_all_tracked_repos(monkeypatch):
    from collector.jobs import _collect_scope

    monkeypatch.setattr("collector.jobs.load_tracked_repos",
                        lambda config_dir: [{"repo": "a/b"}, {"repo": "c/d"}])

    class Stub:
        def __init__(self):
            self.calls = []

        def collect_repo(self, owner, name):
            self.calls.append(f"{owner}/{name}")
            return {"rate_limit_remaining": 1}

    stub = Stub()
    result = _collect_scope(None, stub, _Settings(), None)
    assert stub.calls == ["a/b", "c/d"]
    assert result == {"rate_limit_remaining": 1}


def _record_finish(calls: dict):
    def finish(conn, run_id, status, rate_limit_remaining=None, error=None):
        calls["finished"].append((run_id, status, error))

    return finish
