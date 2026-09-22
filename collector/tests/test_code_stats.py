"""code_stats：/stats/contributors 返回 {} 时不写 0（未就绪），author=null 跳过。"""

from __future__ import annotations

from datetime import UTC, datetime

import collector.code_stats as cs
from collector.github.client import GitHubApiError


class _FakeClient:
    def __init__(self, payload) -> None:
        self._payload = payload
        self.calls: list[str] = []

    def get_json(self, url: str):
        self.calls.append(url)
        return self._payload


class _RaisingClient:
    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def get_json(self, url: str):
        raise self._exc


class _RecordingConn:
    def __init__(self) -> None:
        self.upserts: list[dict] = []


def _collect(monkeypatch, payload):
    writes: list[dict] = []
    monkeypatch.setattr(cs.db, "upsert_contributor", lambda conn, **k: 42)
    monkeypatch.setattr(cs.db, "upsert_code_weekly", lambda conn, **k: writes.append(k))
    conn = _RecordingConn()
    return cs.collect_code_stats(_FakeClient(payload), conn, repo_id=1, owner="o", name="n"), writes


def test_empty_dict_is_not_ready_and_writes_nothing(monkeypatch):
    # 首访 202 预热 → {}：必须当作未就绪，绝不解析成 0 写库。
    n, writes = _collect(monkeypatch, {})
    assert n == 0
    assert writes == []


def test_non_list_is_not_ready(monkeypatch):
    n, writes = _collect(monkeypatch, {"message": "still warming"})
    assert n == 0
    assert writes == []


def test_404_returns_zero_not_exception(monkeypatch):
    monkeypatch.setattr(cs.db, "upsert_code_weekly", lambda conn, **k: None)
    conn = _RecordingConn()
    n = cs.collect_code_stats(
        _RaisingClient(GitHubApiError(404, "Not Found")), conn, repo_id=1, owner="o", name="n"
    )
    assert n == 0


def test_202_empty_body_returns_zero(monkeypatch):
    # 202 预热空 body → httpx .json() 抛 JSONDecodeError（ValueError 子类）→ 未就绪。
    monkeypatch.setattr(cs.db, "upsert_code_weekly", lambda conn, **k: None)
    conn = _RecordingConn()
    n = cs.collect_code_stats(
        _RaisingClient(ValueError("Expecting value: line 1 column 1")),
        conn,
        repo_id=1,
        owner="o",
        name="n",
    )
    assert n == 0


def test_null_author_skipped(monkeypatch):
    writes: list[dict] = []
    monkeypatch.setattr(cs.db, "upsert_contributor", lambda conn, **k: 42)
    monkeypatch.setattr(cs.db, "upsert_code_weekly", lambda conn, **k: writes.append(k))
    conn = _RecordingConn()
    n = cs.collect_code_stats(
        _FakeClient([{"author": None, "weeks": [{"w": 1704067200, "a": 1, "d": 2, "c": 3}]}]),
        conn,
        repo_id=1,
        owner="o",
        name="n",
    )
    assert n == 0
    assert writes == []


def test_writes_weekly_buckets(monkeypatch):
    n, writes = _collect(
        monkeypatch,
        [
            {
                "author": {"login": "alice", "id": 1},
                "weeks": [
                    {"w": 1704067200, "a": 10, "d": 2, "c": 5},
                    {"w": 1704672000, "a": 0, "d": 0, "c": 1},
                ],
            }
        ],
    )
    assert n == 2
    assert writes[0]["gh_login"] == "alice"
    assert writes[0]["author_id"] == 42
    assert writes[0]["additions"] == 10
    assert writes[0]["deletions"] == 2
    assert writes[0]["commits"] == 5
    assert writes[0]["week_start"] == datetime.fromtimestamp(1704067200, tz=UTC).date()
    assert writes[1]["week_start"] == datetime.fromtimestamp(1704672000, tz=UTC).date()
