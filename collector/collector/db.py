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
    email_hash: str | None = None,
    email_masked: str | None = None,
    email_domain: str | None = None,
    email_plain: str | None = None,
) -> int | None:
    if not gh_login:
        return None
    row = conn.execute(
        "INSERT INTO dim_contributor"
        " (gh_login, gh_id, display_name, first_seen_at, last_seen_at,"
        "  email_hash, email_masked, email_domain, email_plain)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (gh_login) DO UPDATE SET"
        "   gh_id = COALESCE(dim_contributor.gh_id, EXCLUDED.gh_id),"
        "   display_name = COALESCE(dim_contributor.display_name, EXCLUDED.display_name),"
        "   first_seen_at = LEAST(dim_contributor.first_seen_at, EXCLUDED.first_seen_at),"
        "   last_seen_at = GREATEST(dim_contributor.last_seen_at, EXCLUDED.last_seen_at),"
        "   email_hash = COALESCE(EXCLUDED.email_hash, dim_contributor.email_hash),"
        "   email_masked = COALESCE(EXCLUDED.email_masked, dim_contributor.email_masked),"
        "   email_domain = COALESCE(EXCLUDED.email_domain, dim_contributor.email_domain),"
        "   email_plain = COALESCE(EXCLUDED.email_plain, dim_contributor.email_plain)"
        " RETURNING contributor_id",
        (gh_login, gh_id, display_name, seen_at, seen_at,
         email_hash, email_masked, email_domain, email_plain),
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


# ---------------------------------------------------------------------------
# 组织分类（dim_org / bridge_contributor_org）
# ---------------------------------------------------------------------------


def upsert_org(conn: Connection, *, key: str, name: str, source: str | None) -> int:
    """按 `key`（dim_org 唯一自然键）幂等 upsert 组织/团队，返回 org_id。"""
    row = conn.execute(
        "INSERT INTO dim_org (name, kind, key, source) VALUES (%s, 'org', %s, %s)"
        " ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, source = EXCLUDED.source"
        " RETURNING org_id",
        (name, key, source),
    ).fetchone()
    return row[0]


def list_classifiable_contributors(conn: Connection) -> list[tuple[int, str, str | None, str | None]]:
    """读取需要分类的贡献者：contributor_id, gh_login, email_domain, company_raw。"""
    rows = conn.execute(
        "SELECT contributor_id, gh_login, email_domain, company_raw"
        " FROM dim_contributor WHERE gh_login IS NOT NULL"
    ).fetchall()
    return [(r[0], r[1], r[2], r[3]) for r in rows]


def upsert_contributor_org(
    conn: Connection,
    *,
    contributor_id: int,
    org_id: int,
    source: str,
    confidence: float,
) -> None:
    """把一名贡献者挂到组织下（`valid_to IS NULL` 为当前行），幂等。

    - 若当前已存在指向同一 (org_id, source) 的有效行，则跳过；
    - 否则关闭该贡献者所有旧的有效行（valid_to = now()），再插入新行。
      分类结果单一（classify() 只返回最高优先级来源），故同一时刻只保留一条当前行。
    """
    row = conn.execute(
        "SELECT 1 FROM bridge_contributor_org"
        " WHERE contributor_id = %s AND org_id = %s AND source = %s AND valid_to IS NULL",
        (contributor_id, org_id, source),
    ).fetchone()
    if row is not None:
        return
    conn.execute(
        "UPDATE bridge_contributor_org SET valid_to = now()"
        " WHERE contributor_id = %s AND valid_to IS NULL",
        (contributor_id,),
    )
    conn.execute(
        "INSERT INTO bridge_contributor_org"
        " (contributor_id, org_id, role, confidence, source, valid_from, valid_to)"
        " VALUES (%s, %s, NULL, %s, %s, now(), NULL)",
        (contributor_id, org_id, confidence, source),
    )


# ---------------------------------------------------------------------------
# 代码量 / wiki 事实表
# ---------------------------------------------------------------------------


def upsert_code_weekly(
    conn: Connection,
    *,
    repo_id: int,
    author_id: int | None,
    gh_login: str,
    week_start,
    commits: int,
    additions: int,
    deletions: int,
) -> None:
    """代码量周桶。周桶随 GitHub 重算而变化，DO UPDATE 可覆盖（幂等）。"""
    conn.execute(
        "INSERT INTO fact_contributor_code_weekly"
        " (repo_id, author_id, gh_login, week_start, commits, additions, deletions)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)"
        " ON CONFLICT (repo_id, week_start, gh_login) DO UPDATE SET"
        "   author_id = EXCLUDED.author_id,"
        "   commits = EXCLUDED.commits,"
        "   additions = EXCLUDED.additions,"
        "   deletions = EXCLUDED.deletions,"
        "   collected_at = now()",
        (repo_id, author_id, gh_login, week_start, commits, additions, deletions),
    )


def upsert_wiki_revision(
    conn: Connection,
    *,
    repo_id: int,
    page_slug: str,
    revision_sha: str,
    author_id: int | None,
    author_email_hash: str | None,
    committed_at: datetime,
    message: str | None,
) -> None:
    """wiki 修订，append-only（DO NOTHING，与 fact_commit 同法）。"""
    conn.execute(
        "INSERT INTO fact_wiki_revision"
        " (repo_id, page_slug, revision_sha, author_id, author_email_hash, committed_at, message)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (repo_id, page_slug, revision_sha, author_id, author_email_hash, committed_at, message),
    )


# ---------------------------------------------------------------------------
# 配额治理辅助：最久未成功采集的仓库优先
# ---------------------------------------------------------------------------


def last_success_by_repo(conn: Connection) -> dict[str, datetime | None]:
    """每仓库最近一次成功采集时间：`full_name -> MAX(finished_at)（仅 success）`。

    未出现过成功采集（collect_run 无对应成功行）的仓库不在字典里——调用方按
    「None = 从未成功」处理并排到最前。用于配额耗尽时跨轮续采：本轮被跳过的
    仓库（旧值/无值）下一轮排在最前，而不是每轮都从第 1 个仓库重来。
    """
    rows = conn.execute(
        "SELECT d.owner, d.name,"
        "       MAX(r.finished_at) FILTER (WHERE r.status = 'success') AS last_success"
        " FROM dim_repo d LEFT JOIN collect_run r ON r.repo_id = d.repo_id"
        " GROUP BY d.owner, d.name"
    ).fetchall()
    return {f"{owner}/{name}": ts for owner, name, ts in rows}