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