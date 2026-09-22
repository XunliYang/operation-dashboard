"""GitHubCollector._ingest_pull_request 的 review 字段语义（P1-1 回归防护）。

核心不变量：review_count / first_review_at 只在「本轮真正拉取了 review」时才被
写入（拉取后可为真实的 0）；未拉取时传 None，由 SQL 侧 COALESCE 保留旧值，
避免久未更新 PR 的 review 指标被清零。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import collector.collector as cc


class _FakeClient:
    def __init__(self, reviews: list[dict] | None = None) -> None:
        self._reviews = reviews if reviews is not None else []
        self.review_calls = 0

    def get_json(self, url: str):
        assert url.endswith("/reviews")
        self.review_calls += 1
        return self._reviews


def _collector(client, monkeypatch):
    captured: dict = {}

    monkeypatch.setattr(cc.db, "upsert_contributor", lambda conn, **k: 1)
    monkeypatch.setattr(cc.db, "upsert_review", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "upsert_pull_request", lambda conn, **kwargs: captured.update(kwargs))

    col = cc.GitHubCollector(client, object(), backfill_days=90)
    return col, captured


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def test_stale_pr_skips_reviews_and_passes_none(monkeypatch):
    client = _FakeClient([{"submitted_at": _iso(datetime.now(UTC) - timedelta(days=1)),
                           "user": {"login": "r", "id": 1}}])
    col, captured = _collector(client, monkeypatch)

    col._ingest_pull_request(1, "o", "n", {
        "number": 42,
        "created_at": _iso(datetime.now(UTC) - timedelta(days=400)),
        "updated_at": _iso(datetime.now(UTC) - timedelta(days=200)),  # 早于 review_cutoff
        "user": {"login": "a", "id": 2},
    })

    assert client.review_calls == 0
    assert captured["review_count"] is None
    assert captured["first_review_at"] is None


def test_fresh_pr_with_zero_reviews_writes_zero(monkeypatch):
    client = _FakeClient([])
    col, captured = _collector(client, monkeypatch)

    col._ingest_pull_request(1, "o", "n", {
        "number": 42,
        "created_at": _iso(datetime.now(UTC) - timedelta(days=30)),
        "updated_at": _iso(datetime.now(UTC)),  # 窗口内 → 拉取 review
        "user": {"login": "a", "id": 2},
    })

    assert client.review_calls == 1
    assert captured["review_count"] == 0  # 拉了但确无 review → 合法 0
    assert captured["first_review_at"] is None


def test_fresh_pr_with_reviews_writes_count_and_first_review(monkeypatch):
    first = datetime(2026, 1, 3, tzinfo=UTC)
    second = datetime(2026, 1, 5, tzinfo=UTC)
    client = _FakeClient([
        {"submitted_at": _iso(second), "user": {"login": "r2", "id": 12}},
        {"submitted_at": _iso(first), "user": {"login": "r1", "id": 11}},
    ])
    col, captured = _collector(client, monkeypatch)

    col._ingest_pull_request(1, "o", "n", {
        "number": 42,
        "created_at": _iso(datetime.now(UTC) - timedelta(days=30)),
        "updated_at": _iso(datetime.now(UTC)),
        "user": {"login": "a", "id": 2},
    })

    assert captured["review_count"] == 2
    assert captured["first_review_at"] == first  # 取最早的 submitted_at


# --- LEOY-20：full_backfill 语义 —— 回填忽略游标，增量保留游标 ---


class _RecordingClient:
    """记录 paged 实际发出的 params / stop_after，供断言采集路径使用。"""

    def __init__(self) -> None:
        self.paged_calls: list[dict] = []
        self.rate_limit = None

    def get_json(self, url: str):
        if url == "/repos/o/n":
            return {
                "id": 1,
                "default_branch": "main",
                "archived": False,
                "stargazers_count": 0,
                "forks_count": 0,
                "subscribers_count": 0,
                "open_issues_count": 0,
            }
        return {}

    def paged(self, url, params=None, *, max_pages=40, items_key=None, stop_after=None):
        self.paged_calls.append({"url": url, "params": params, "stop_after": stop_after})
        return []


def _collector_for_collect_repo(client, monkeypatch):
    monkeypatch.setattr(cc.db, "upsert_repo", lambda conn, **k: 1)
    monkeypatch.setattr(cc.db, "upsert_commit", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "upsert_pull_request", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "upsert_issue", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "upsert_workflow_run", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "upsert_repo_metric_daily", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "parse_dt", lambda s: None)
    cursor = datetime(2026, 1, 1, tzinfo=UTC)
    monkeypatch.setattr(cc.db, "pulls_cursor", lambda conn, repo_id: cursor)
    # 收尾步骤（代码量 / wiki）不参与游标测试：桩掉避免真实网络与 subprocess。
    monkeypatch.setattr(
        "collector.code_stats.collect_code_stats",
        lambda client, conn, *, repo_id, owner, name: 0,
    )
    monkeypatch.setattr(
        "collector.wiki.collect_wiki", lambda conn, *, repo_id, owner, name, salt: 0
    )
    col = cc.GitHubCollector(client, object(), backfill_days=90)
    monkeypatch.setattr(col, "_commits_cursor", lambda repo_id: cursor)
    return col


def test_collect_repo_full_backfill_ignores_cursors(monkeypatch):
    client = _RecordingClient()
    col = _collector_for_collect_repo(client, monkeypatch)

    col.collect_repo("o", "n", full_backfill=True)

    calls_by_url = {c["url"]: c for c in client.paged_calls}
    commits = calls_by_url["/repos/o/n/commits"]
    pulls = calls_by_url["/repos/o/n/pulls"]
    assert "since" not in commits["params"]
    assert pulls["stop_after"] is None


def test_collect_repo_incremental_keeps_cursors(monkeypatch):
    client = _RecordingClient()
    col = _collector_for_collect_repo(client, monkeypatch)

    col.collect_repo("o", "n", full_backfill=False)

    calls_by_url = {c["url"]: c for c in client.paged_calls}
    commits = calls_by_url["/repos/o/n/commits"]
    pulls = calls_by_url["/repos/o/n/pulls"]
    assert commits["params"]["since"] == datetime(2026, 1, 1, tzinfo=UTC).isoformat()
    assert pulls["stop_after"] is not None


# --- LEOY-47：commit 邮箱 → 哈希/脱敏落库 + review 配额取舍 ---


def test_ingest_commit_persists_hashed_email(monkeypatch):
    from app.services.org_classifier import hash_email

    captured: dict = {}
    monkeypatch.setattr(cc.db, "upsert_commit", lambda conn, **k: None)
    monkeypatch.setattr(cc.db, "upsert_contributor", lambda conn, **k: captured.update(k) or 1)
    monkeypatch.setattr(cc.db, "parse_dt", lambda s: None)

    col = cc.GitHubCollector(object(), object(), backfill_days=90, email_hash_salt="salt")
    col._ingest_commit(1, {
        "sha": "abc",
        "commit": {
            "author": {"name": "Alice", "email": "Alice@Huawei.com", "date": "2026-01-01T00:00:00Z"},
            "committer": {},
        },
        "author": {"login": "alice", "id": 1},
        "parents": [],
    })

    assert captured["email_masked"] == "a***@huawei.com"
    assert captured["email_domain"] == "huawei.com"
    assert captured["email_hash"] == hash_email("Alice@Huawei.com", "salt")
    # 明文邮箱不落库（哈希不包含明文）
    assert "Alice@Huawei.com" not in captured["email_hash"]


def test_review_floor_skips_reviews_before_cursor(monkeypatch):
    client = _FakeClient([])
    col, captured = _collector(client, monkeypatch)
    floor = datetime.now(UTC) - timedelta(days=3)
    col._ingest_pull_request(1, "o", "n", {
        "number": 42,
        "created_at": _iso(datetime.now(UTC) - timedelta(days=10)),
        "updated_at": _iso(datetime.now(UTC) - timedelta(days=5)),  # 早于 review_floor
        "user": {"login": "a", "id": 2},
    }, review_floor=floor)
    assert client.review_calls == 0
    assert captured["review_count"] is None
    assert captured["first_review_at"] is None


def test_review_floor_fetches_reviews_after_cursor(monkeypatch):
    client = _FakeClient([])
    col, captured = _collector(client, monkeypatch)
    floor = datetime.now(UTC) - timedelta(days=3)
    col._ingest_pull_request(1, "o", "n", {
        "number": 42,
        "created_at": _iso(datetime.now(UTC) - timedelta(days=10)),
        "updated_at": _iso(datetime.now(UTC)),  # 晚于 review_floor
        "user": {"login": "a", "id": 2},
    }, review_floor=floor)
    assert client.review_calls == 1
    assert captured["review_count"] == 0