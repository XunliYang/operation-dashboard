"""db.upsert_pull_request 的 review 字段条件更新（P1-1 SQL 侧回归防护）。

保证 DB 层对 review_count / first_review_at 使用 COALESCE 保留旧值，而不是
无条件覆盖——未拉取 review 时调用方传 None，旧值必须不受影响。
"""

from __future__ import annotations

from datetime import UTC, date, datetime

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

    def fetchone(self):
        return (1,)

    def fetchall(self):
        return []


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


# --- LEOY-47：邮箱落库 / 代码量 / wiki / 公平调度 ---


def test_upsert_contributor_persists_hashed_email_fields():
    conn = _RecordingConn()
    db.upsert_contributor(
        conn,
        gh_login="alice",
        gh_id=1,
        display_name="Alice",
        seen_at=_TS,
        email_hash="deadbeef",
        email_masked="a***@huawei.com",
        email_domain="huawei.com",
        email_plain="alice@huawei.com",
    )
    assert conn.sql is not None and "email_hash" in conn.sql and "email_masked" in conn.sql
    assert "email_domain" in conn.sql and "email_plain" in conn.sql
    # 三列同写：脱敏形、域名、明文（需求方 2026-09-22 拍板「明文，不脱敏」）
    joined = " ".join(str(p) for p in (conn.params or ()))
    assert "a***@huawei.com" in joined
    assert "huawei.com" in joined
    assert "alice@huawei.com" in joined


def test_upsert_contributor_coalesces_email_on_update():
    # 后续采集若不传邮箱，已有的 email_* 值用 COALESCE 保留旧值，不被 NULL 覆盖。
    conn = _RecordingConn()
    db.upsert_contributor(conn, gh_login="alice", gh_id=1, display_name="a", seen_at=_TS)
    assert "email_hash = COALESCE(EXCLUDED.email_hash, dim_contributor.email_hash)" in conn.sql
    assert "email_plain = COALESCE(EXCLUDED.email_plain, dim_contributor.email_plain)" in conn.sql


def test_upsert_code_weekly_overwrites_on_conflict():
    conn = _RecordingConn()
    db.upsert_code_weekly(
        conn,
        repo_id=1,
        author_id=5,
        gh_login="alice",
        week_start=date(2026, 1, 1),
        commits=3,
        additions=10,
        deletions=2,
    )
    # 周桶会随 GitHub 重算而变化：必须 DO UPDATE 可覆盖。
    assert "ON CONFLICT (repo_id, week_start, gh_login) DO UPDATE" in conn.sql


def test_upsert_wiki_revision_is_append_only():
    conn = _RecordingConn()
    db.upsert_wiki_revision(
        conn,
        repo_id=1,
        page_slug="Home",
        revision_sha="abc",
        author_id=None,
        author_email_hash="h",
        committed_at=_TS,
        message="rev",
    )
    # append-only，与 fact_commit 同法（DO NOTHING）。
    assert "ON CONFLICT DO NOTHING" in conn.sql


def test_last_success_by_repo_maps_full_name_to_ts():
    class _Conn:
        def execute(self, sql, params=None):
            return self

        def fetchall(self):
            return [("o", "n1", _TS), ("o", "n2", None)]

    result = db.last_success_by_repo(_Conn())
    assert result == {"o/n1": _TS, "o/n2": None}