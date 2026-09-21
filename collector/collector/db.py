"""PostgreSQL 写入：维度/事实表 upsert + collect_run。

所有事实表 `ON CONFLICT` 幂等：重复采集不会产生重复行。
`fact_commit` / `fact_review` 为 append-only（DO NOTHING）；
`fact_pull_request` / `fact_issue` / `fact_workflow_run` 状态可变（DO UPDATE）。
"""

from __future__ import annotations

from datetime import datetime

from psycopg import Connection, connect
from psycopg.types.json import Jsonb


def parse_dt(value: str | None) -> datetime | None:
    """GitHub ISO8601（可能带 'Z' 或偏移）→ 时区感知 datetime。"""
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text)


def connect_db(url: str) -> Connection:
    return connect(url)


# ---------------------------------------------------------------------------
# 维度表
# ---------------------------------------------------------------------------

def upsert_repo(
    conn: Connection, *, gh_id: int, owner: str, name: str, default_branch: str, archived: bool
) -> int:
    row = conn.execute(
        "INSERT INTO dim_repo (gh_id, owner, name, default_branch, archived)"
        " VALUES (%s, %s, %s, %s, %s)"
        " ON CONFLICT (owner, name) DO UPDATE SET"
        "   gh_id = EXCLUDED.gh_id,"
        "   default_branch = EXCLUDED.default_branch,"
        "   archived = EXCLUDED.archived"
        " RETURNING repo_id",
        (gh_id, owner, name, default_branch, archived),
    ).fetchone()
    return row[0]


def upsert_contributor(
    conn: Connection,
    *,
    gh_login: str | None,
    gh_id: int | None,
    display_name: str | None,
    seen_at: datetime,
) -> int | None:
    if not gh_login:
        return None
    row = conn.execute(
        "INSERT INTO dim_contributor (gh_login, gh_id, display_name, first_seen_at, last_seen_at)"
        " VALUES (%s, %s, %s, %s, %s)"
        " ON CONFLICT (gh_login) DO UPDATE SET"
        "   gh_id = COALESCE(dim_contributor.gh_id, EXCLUDED.gh_id),"
        "   display_name = COALESCE(dim_contributor.display_name, EXCLUDED.display_name),"
        "   first_seen_at = LEAST(dim_contributor.first_seen_at, EXCLUDED.first_seen_at),"
        "   last_seen_at = GREATEST(dim_contributor.last_seen_at, EXCLUDED.last_seen_at)"
        " RETURNING contributor_id",
        (gh_login, gh_id, display_name, seen_at, seen_at),
    ).fetchone()
    return row[0]


# ---------------------------------------------------------------------------
# 事实表
# ---------------------------------------------------------------------------

def upsert_commit(
    conn: Connection,
    *,
    repo_id: int,
    sha: str,
    author_id: int | None,
    committed_at: datetime,
    branch: str | None,
    additions: int | None,
    deletions: int | None,
    files_changed: int | None,
    is_merge: bool,
) -> None:
    conn.execute(
        "INSERT INTO fact_commit"
        " (repo_id, sha, author_id, committed_at, branch, additions, deletions, files_changed, is_merge)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (repo_id, sha, author_id, committed_at, branch, additions, deletions, files_changed, is_merge),
    )


def upsert_pull_request(
    conn: Connection,
    *,
    repo_id: int,
    pr_number: int,
    author_id: int | None,
    state: str,
    title: str | None,
    created_at: datetime,
    updated_at: datetime | None,
    first_review_at: datetime | None,
    merged_at: datetime | None,
    closed_at: datetime | None,
    review_count: int | None,
    additions: int | None,
    deletions: int | None,
) -> None:
    # review_count / first_review_at 只在「本轮真正拉取了 review」时覆盖：
    # 未拉取时传 None，SQL 用 COALESCE 保留旧值。review_count 的合法值包含
    # 真实的 0（「已拉取但确无 review」），不能用 0 作为「未拉取」哨兵。
    conn.execute(
        "INSERT INTO fact_pull_request"
        " (repo_id, pr_number, author_id, state, title, created_at, updated_at,"
        "  first_review_at, merged_at, closed_at, review_count, additions, deletions)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (repo_id, pr_number, created_at) DO UPDATE SET"
        "   state = EXCLUDED.state,"
        "   updated_at = EXCLUDED.updated_at,"
        "   first_review_at = COALESCE(EXCLUDED.first_review_at, fact_pull_request.first_review_at),"
        "   merged_at = EXCLUDED.merged_at,"
        "   closed_at = EXCLUDED.closed_at,"
        "   review_count = COALESCE(EXCLUDED.review_count, fact_pull_request.review_count),"
        "   additions = EXCLUDED.additions,"
        "   deletions = EXCLUDED.deletions",
        (repo_id, pr_number, author_id, state, title, created_at, updated_at,
         first_review_at, merged_at, closed_at, review_count, additions, deletions),
    )


def upsert_issue(
    conn: Connection,
    *,
    repo_id: int,
    issue_number: int,
    author_id: int | None,
    state: str,
    title: str | None,
    is_pull_request: bool,
    created_at: datetime,
    closed_at: datetime | None,
    labels: list[str],
) -> None:
    conn.execute(
        "INSERT INTO fact_issue"
        " (repo_id, issue_number, author_id, state, title, is_pull_request, created_at, closed_at, labels)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (repo_id, issue_number, created_at) DO UPDATE SET"
        "   state = EXCLUDED.state,"
        "   closed_at = EXCLUDED.closed_at,"
        "   labels = EXCLUDED.labels,"
        "   is_pull_request = EXCLUDED.is_pull_request",
        (repo_id, issue_number, author_id, state, title, is_pull_request, created_at,
         closed_at, Jsonb(labels)),
    )


def upsert_review(
    conn: Connection,
    *,
    repo_id: int,
    pr_number: int,
    reviewer_id: int | None,
    submitted_at: datetime,
    state: str | None,
) -> None:
    conn.execute(
        "INSERT INTO fact_review (repo_id, pr_number, reviewer_id, submitted_at, state)"
        " VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (repo_id, pr_number, reviewer_id, submitted_at, state),
    )


def upsert_workflow_run(
    conn: Connection,
    *,
    repo_id: int,
    run_id: int,
    workflow_name: str | None,
    conclusion: str | None,
    status: str | None,
    started_at: datetime,
    completed_at: datetime | None,
    duration_s: int | None,
) -> None:
    conn.execute(
        "INSERT INTO fact_workflow_run"
        " (repo_id, run_id, workflow_name, conclusion, status, started_at, completed_at, duration_s)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (repo_id, run_id, started_at) DO UPDATE SET"
        "   conclusion = EXCLUDED.conclusion,"
        "   status = EXCLUDED.status,"
        "   completed_at = EXCLUDED.completed_at,"
        "   duration_s = EXCLUDED.duration_s",
        (repo_id, run_id, workflow_name, conclusion, status, started_at, completed_at, duration_s),
    )


def upsert_repo_metric_daily(
    conn: Connection,
    *,
    repo_id: int,
    date,
    stars: int,
    forks: int,
    watchers: int,
    open_issues: int,
    open_prs: int,
) -> None:
    conn.execute(
        "INSERT INTO fact_repo_metric_daily"
        " (repo_id, date, stars, forks, watchers, open_issues, open_prs)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (repo_id, date) DO UPDATE SET"
        "   stars = EXCLUDED.stars, forks = EXCLUDED.forks, watchers = EXCLUDED.watchers,"
        "   open_issues = EXCLUDED.open_issues, open_prs = EXCLUDED.open_prs",
        (repo_id, date, stars, forks, watchers, open_issues, open_prs),
    )


# ---------------------------------------------------------------------------
# collect_run
# ---------------------------------------------------------------------------

def start_collect_run(conn: Connection, *, job: str, repo_id: int | None, cursor: str | None = None) -> int:
    row = conn.execute(
        "INSERT INTO collect_run (job, repo_id, cursor, status) VALUES (%s, %s, %s, 'running')"
        " RETURNING run_id",
        (job, repo_id, cursor),
    ).fetchone()
    return row[0]


def finish_collect_run(
    conn: Connection,
    *,
    run_id: int,
    status: str,
    rate_limit_remaining: int | None = None,
    error: str | None = None,
) -> None:
    conn.execute(
        "UPDATE collect_run SET status=%s, finished_at=now(), rate_limit_remaining=%s, error=%s"
        " WHERE run_id=%s",
        (status, rate_limit_remaining, error, run_id),
    )


def pulls_cursor(conn: Connection, *, repo_id: int) -> datetime | None:
    """pulls 增量游标：该仓库已摄入 PR 的最大 `updated_at`。

    首轮（表空）返回 None，即全量回填；之后按 `sort=updated&direction=desc`
    早停，只拉取游标之后更新的 PR，避免整表重拉与逐 PR reviews 的 N+1。
    """
    row = conn.execute(
        "SELECT MAX(updated_at) FROM fact_pull_request WHERE repo_id = %s", (repo_id,)
    ).fetchone()
    if row and row[0]:
        return row[0]
    return None


def claim_queued_collect_runs(conn: Connection) -> list[tuple[int, str, int | None]]:
    """认领 `POST /admin/collect` 落库的 queued 请求（只取本采集器认识的 job）。

    用 `FOR UPDATE SKIP LOCKED` 避免多实例并发重复认领；调度器另有 redis 锁兜底。
    """
    rows = conn.execute(
        "SELECT run_id, job, repo_id FROM collect_run"
        " WHERE status = 'queued' AND job IN ('github_incremental', 'github_backfill')"
        " ORDER BY run_id FOR UPDATE SKIP LOCKED"
    ).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def mark_collect_run_running(conn: Connection, *, run_id: int) -> None:
    conn.execute(
        "UPDATE collect_run SET status = 'running', started_at = now() WHERE run_id = %s",
        (run_id,),
    )


def repo_ref(conn: Connection, *, repo_id: int) -> tuple[str, str] | None:
    """repo_id → (owner, name)；不存在返回 None。"""
    row = conn.execute(
        "SELECT owner, name FROM dim_repo WHERE repo_id = %s", (repo_id,)
    ).fetchone()
    if row is None:
        return None
    return row[0], row[1]