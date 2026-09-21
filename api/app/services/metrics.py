"""指标抽取：从事实表聚合出五维度原始指标（对齐 health_weights.yaml 的指标键）。

全部查询以「截至 as_of 的最近 window_days 天」为滚动窗口。值为 None 表示该
指标在当前窗口无足够数据（如无 PR），评分层会跳过缺失指标，不做黑箱补值。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from psycopg import Connection

# 指标键 -> 记忆化 SQL 片段见各函数；此处只声明可空指标集合，便于测试断言。
COMMITS = "commits"
ACTIVE_CONTRIBUTORS = "active_contributors"
PRS_MERGED = "prs_merged"
ISSUES_CLOSED = "issues_closed"
PR_FIRST_REVIEW_MEDIAN_HOURS = "pr_first_review_median_hours"
PR_MERGE_MEDIAN_HOURS = "pr_merge_median_hours"
REVIEW_COVERAGE = "review_coverage"
STALE_OPEN_RATIO = "stale_open_ratio"
CI_SUCCESS_RATE = "ci_success_rate"
BUG_ISSUE_RATIO = "bug_issue_ratio"
STAR_GROWTH = "star_growth"
FORK_GROWTH = "fork_growth"
NEW_CONTRIBUTORS = "new_contributors"
BUS_FACTOR_TOP1 = "bus_factor_top1"
BUS_FACTOR_TOP3 = "bus_factor_top3"
CONTRIBUTOR_RETENTION = "contributor_retention"


def _scalar(conn: Connection, sql: str, params: tuple) -> Any | None:
    row = conn.execute(sql, params).fetchone()
    if row is None:
        return None
    return row[0]


def _to_float(value: Any | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    return float(value)


def _window(as_of: datetime, days: int) -> tuple[datetime, datetime]:
    return as_of - timedelta(days=days), as_of


def _activity(conn: Connection, repo_id: int, start: datetime, end: datetime) -> dict[str, float]:
    commits = _scalar(
        conn,
        "SELECT COUNT(*) FROM fact_commit WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s",
        (repo_id, start, end),
    )
    active = _scalar(
        conn,
        "SELECT COUNT(DISTINCT author_id) FROM fact_commit"
        " WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s AND author_id IS NOT NULL",
        (repo_id, start, end),
    )
    prs_merged = _scalar(
        conn,
        "SELECT COUNT(*) FROM fact_pull_request WHERE repo_id=%s AND merged_at > %s AND merged_at <= %s",
        (repo_id, start, end),
    )
    issues_closed = _scalar(
        conn,
        "SELECT COUNT(*) FROM fact_issue"
        " WHERE repo_id=%s AND is_pull_request=false AND closed_at > %s AND closed_at <= %s",
        (repo_id, start, end),
    )
    return {
        COMMITS: int(commits or 0),
        ACTIVE_CONTRIBUTORS: int(active or 0),
        PRS_MERGED: int(prs_merged or 0),
        ISSUES_CLOSED: int(issues_closed or 0),
    }


def _collaboration(
    conn: Connection, repo_id: int, start: datetime, end: datetime, stale_days: int
) -> dict[str, float]:
    first_review_s = _scalar(
        conn,
        "SELECT percentile_cont(0.5) WITHIN GROUP"
        " (ORDER BY EXTRACT(EPOCH FROM (first_review_at - created_at)))"
        " FROM fact_pull_request"
        " WHERE repo_id=%s AND created_at > %s AND created_at <= %s AND first_review_at IS NOT NULL",
        (repo_id, start, end),
    )
    merge_s = _scalar(
        conn,
        "SELECT percentile_cont(0.5) WITHIN GROUP"
        " (ORDER BY EXTRACT(EPOCH FROM (merged_at - created_at)))"
        " FROM fact_pull_request"
        " WHERE repo_id=%s AND merged_at > %s AND merged_at <= %s AND merged_at IS NOT NULL",
        (repo_id, start, end),
    )
    review_cov = _scalar(
        conn,
        "SELECT COUNT(*) FILTER (WHERE review_count > 0)::float / NULLIF(COUNT(*), 0)"
        " FROM fact_pull_request WHERE repo_id=%s AND created_at > %s AND created_at <= %s",
        (repo_id, start, end),
    )
    stale_before = end - timedelta(days=stale_days)
    stale = _scalar(
        conn,
        "SELECT"
        "  (SELECT COUNT(*) FROM fact_pull_request WHERE repo_id=%s AND state='open' AND created_at < %s)"
        " + (SELECT COUNT(*) FROM fact_issue WHERE repo_id=%s AND is_pull_request=false AND state='open' AND created_at < %s)"
        " AS stale_count",
        (repo_id, stale_before, repo_id, stale_before),
    )
    open_total = _scalar(
        conn,
        "SELECT"
        "  (SELECT COUNT(*) FROM fact_pull_request WHERE repo_id=%s AND state='open')"
        " + (SELECT COUNT(*) FROM fact_issue WHERE repo_id=%s AND is_pull_request=false AND state='open')",
        (repo_id, repo_id),
    )

    out: dict[str, float] = {}
    if first_review_s is not None:
        out[PR_FIRST_REVIEW_MEDIAN_HOURS] = float(first_review_s) / 3600.0
    if merge_s is not None:
        out[PR_MERGE_MEDIAN_HOURS] = float(merge_s) / 3600.0
    if review_cov is not None:
        out[REVIEW_COVERAGE] = float(review_cov)
    if open_total:
        out[STALE_OPEN_RATIO] = float(stale or 0) / float(open_total)
    return out


def _quality(conn: Connection, repo_id: int, start: datetime, end: datetime) -> dict[str, float]:
    ci = _scalar(
        conn,
        "SELECT COUNT(*) FILTER (WHERE conclusion='success')::float"
        " / NULLIF(COUNT(*) FILTER (WHERE conclusion IS NOT NULL AND conclusion <> ''), 0)"
        " FROM fact_workflow_run WHERE repo_id=%s AND started_at > %s AND started_at <= %s",
        (repo_id, start, end),
    )
    bug = _scalar(
        conn,
        "SELECT COUNT(*) FILTER (WHERE labels ? 'bug')::float / NULLIF(COUNT(*), 0)"
        " FROM fact_issue WHERE repo_id=%s AND is_pull_request=false"
        " AND created_at > %s AND created_at <= %s",
        (repo_id, start, end),
    )
    out: dict[str, float] = {}
    if ci is not None:
        out[CI_SUCCESS_RATE] = float(ci)
    if bug is not None:
        out[BUG_ISSUE_RATIO] = float(bug)
    return out


def _snapshot_value(conn: Connection, repo_id: int, column: str, upto: date) -> float | None:
    return _to_float(
        _scalar(
            conn,
            f"SELECT {column} FROM fact_repo_metric_daily WHERE repo_id=%s AND date <= %s"
            " ORDER BY date DESC LIMIT 1",
            (repo_id, upto),
        )
    )


def _community(conn: Connection, repo_id: int, start: date, end: date) -> dict[str, float]:
    stars_now = _snapshot_value(conn, repo_id, "stars", end)
    forks_now = _snapshot_value(conn, repo_id, "forks", end)
    stars_prev = _snapshot_value(conn, repo_id, "stars", start)
    forks_prev = _snapshot_value(conn, repo_id, "forks", start)
    new_contrib = _scalar(
        conn,
        "SELECT COUNT(*) FROM dim_contributor"
        " WHERE first_seen_at IS NOT NULL AND first_seen_at > %s AND first_seen_at <= %s",
        (start, end),
    )

    out: dict[str, float] = {}
    if stars_now is not None and stars_prev is not None:
        out[STAR_GROWTH] = stars_now - stars_prev
    if forks_now is not None and forks_prev is not None:
        out[FORK_GROWTH] = forks_now - forks_prev
    out[NEW_CONTRIBUTORS] = int(new_contrib or 0)
    return out


def _sustainability(conn: Connection, repo_id: int, start: datetime, end: datetime) -> dict[str, float]:
    rows = conn.execute(
        "SELECT COUNT(*) FROM fact_commit WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s"
        " AND author_id IS NOT NULL GROUP BY author_id ORDER BY COUNT(*) DESC",
        (repo_id, start, end),
    ).fetchall()
    total = sum(r[0] for r in rows)
    if total > 0 and rows:
        top1 = rows[0][0] / total
        top3 = sum(r[0] for r in rows[:3]) / total
    else:
        return {}

    out = {BUS_FACTOR_TOP1: float(top1), BUS_FACTOR_TOP3: float(top3)}

    cohort_start = start - timedelta(days=30)
    cohort_end = start
    cohort = {r[0] for r in conn.execute(
        "SELECT DISTINCT author_id FROM fact_commit"
        " WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s AND author_id IS NOT NULL",
        (repo_id, cohort_start, cohort_end),
    ).fetchall()}
    retained = {r[0] for r in conn.execute(
        "SELECT DISTINCT author_id FROM fact_commit"
        " WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s AND author_id IS NOT NULL",
        (repo_id, start, end),
    ).fetchall()}
    if cohort:
        out[CONTRIBUTOR_RETENTION] = len(retained & cohort) / len(cohort)
    return out


def get_repo_indicators(
    conn: Connection,
    repo_id: int,
    as_of: datetime | None = None,
    window_days: int = 30,
) -> dict[str, float]:
    """聚合单个仓库截至 `as_of` 的五维度原始指标（窗口 `window_days` 天）。"""
    as_of = as_of or datetime.now(UTC)
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=UTC)
    start, end = _window(as_of, window_days)

    indicators: dict[str, float] = {}
    indicators.update(_activity(conn, repo_id, start, end))
    indicators.update(_collaboration(conn, repo_id, start, end, stale_days=30))

    # 质量/社区/可持续再独立窗口一次（天数与主窗口一致）
    indicators.update(_quality(conn, repo_id, start, end))
    indicators.update(_community(conn, repo_id, start.date(), end.date()))
    indicators.update(_sustainability(conn, repo_id, start, end))
    return indicators