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


def test_upsert_contributor_seen_at_comes_from_last_active_week_not_now(monkeypatch):
    # LEOY-70：seen_at 必须来自该作者「存在提交(c>0)的最大周」，而不能是 now()。
    last_active = datetime(2026, 5, 10, tzinfo=UTC)
    ts_last_active = int(last_active.timestamp())
    seen: list[datetime] = []

    def fake_upsert_contributor(conn, **kwargs):
        seen.append(kwargs["seen_at"])
        return 42

    monkeypatch.setattr(cs.db, "upsert_contributor", fake_upsert_contributor)
    monkeypatch.setattr(cs.db, "upsert_code_weekly", lambda conn, **k: None)
    conn = _RecordingConn()

    cs.collect_code_stats(
        _FakeClient(
            [
                {
                    "author": {"login": "alice", "id": 1},
                    "weeks": [
                        # 更早、且 c==0 的周：不应成为 seen_at
                        {"w": int(datetime(2026, 4, 12, tzinfo=UTC).timestamp()), "a": 1, "d": 1, "c": 0},
                        # 最后活跃周 2026-05-10（c>0）
                        {"w": ts_last_active, "a": 10, "d": 2, "c": 5},
                    ],
                }
            ]
        ),
        conn,
        repo_id=1,
        owner="o",
        name="n",
    )

    assert seen == [last_active]
    # 防御性断言：seen_at 必须落在历史（该周），而不是测试运行的「当下」。
    assert (datetime.now(UTC) - seen[0]).total_seconds() > 86400


def test_zero_commit_author_does_not_upsert_contributor(monkeypatch):
    # 全部周 c==0：不得 upsert 贡献者（否则会把 last_seen_at 刷成 today），
    # author_id 落 NULL（该列本就允许为空），不得推进 last_seen_at。
    calls: list[dict] = []
    writes: list[dict] = []
    monkeypatch.setattr(cs.db, "upsert_contributor", lambda conn, **k: calls.append(k))
    monkeypatch.setattr(cs.db, "upsert_code_weekly", lambda conn, **k: writes.append(k))
    conn = _RecordingConn()

    n = cs.collect_code_stats(
        _FakeClient(
            [
                {
                    "author": {"login": "ghost", "id": 9},
                    "weeks": [{"w": 1704067200, "a": 0, "d": 0, "c": 0}],
                }
            ]
        ),
        conn,
        repo_id=1,
        owner="o",
        name="n",
    )

    assert calls == []  # 未调用 upsert_contributor → last_seen_at 未被推进
    assert n == 1
    assert writes[0]["author_id"] is None
