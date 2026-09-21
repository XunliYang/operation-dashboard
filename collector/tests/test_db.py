"""db.upsert_pull_request 的 review 字段条件更新（P1-1 SQL 侧回归防护）。

保证 DB 层对 review_count / first_review_at 使用 COALESCE 保留旧值，而不是
无条件覆盖——未拉取 review 时调用方传 None，旧值必须不受影响。
"""

from __future__ import annotations

from datetime import UTC, datetime

import collector.db as db

_TS = datetime(2026, 1, 1, tzinfo=UTC)


class _RecordingConn:
    def __init__(self) -> None:
        self.sql: str | None = None
        self.params: tuple | None = None

    def execute(self, sql: str, params=None):
        self.sql = sql
        self.params = params
        return self


def test_upsert_pr_preserves_review_fields_via_coalesce():
    conn = _RecordingConn()
    db.upsert_pull_request(
        conn,
        repo_id=1,
        pr_number=1,
        author_id=None,
        state="open",
        title="t",
        created_at=_TS,
        updated_at=None,
        first_review_at=None,
        merged_at=None,
        closed_at=None,
        review_count=None,
        additions=None,
        deletions=None,
    )
    assert conn.sql is not None
    # 关键：不能再用 `review_count = EXCLUDED.review_count` 无条件覆盖
    assert "review_count = COALESCE(EXCLUDED.review_count, fact_pull_request.review_count)" in conn.sql
    assert "first_review_at = COALESCE(EXCLUDED.first_review_at, fact_pull_request.first_review_at)" in conn.sql
    # 未拉取时 review_count / first_review_at 以 None 传入（区别于合法值 0）
    assert conn.params is not None and conn.params[10] is None  # review_count
    assert conn.params[7] is None  # first_review_at


def test_upsert_pr_inserts_updated_at_column():
    conn = _RecordingConn()
    db.upsert_pull_request(
        conn,
        repo_id=1,
        pr_number=1,
        author_id=None,
        state="open",
        title=None,
        created_at=_TS,
        updated_at=_TS,
        first_review_at=None,
        merged_at=None,
        closed_at=None,
        review_count=0,
        additions=None,
        deletions=None,
    )
    assert conn.sql is not None and "updated_at" in conn.sql
    # 拉取后 review_count 写为真实值（含 0），而不是 None
    assert conn.params is not None and conn.params[10] == 0