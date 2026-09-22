"""看板 A · 仓库路由（`/dashboard/repos`）。

统一响应包装沿用 `{code,message,data,request_id}`（nginx 已剥掉 `/rest/v1` 前缀）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from psycopg import Connection

from app.core.config import get_settings
from app.core.response import CODE_OK, api_json
from app.routers.deps import db_conn, health_weights, resolve_repo
from app.services.health import compute_health_series, compute_repo_health
from app.services.metrics import get_repo_indicators
from app.services.weights import HealthWeights

router = APIRouter(prefix="/dashboard/repos", tags=["repos"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _latest_snapshot(conn: Connection, repo_id: int) -> dict:
    row = conn.execute(
        "SELECT stars, forks, watchers, open_issues, open_prs, date"
        " FROM fact_repo_metric_daily WHERE repo_id = %s ORDER BY date DESC LIMIT 1",
        (repo_id,),
    ).fetchone()
    if row is None:
        return {"stars": 0, "forks": 0, "watchers": 0, "open_issues": 0, "open_prs": 0, "date": None}
    return {
        "stars": row[0], "forks": row[1], "watchers": row[2],
        "open_issues": row[3], "open_prs": row[4],
        "date": row[5].isoformat() if row[5] else None,
    }


@router.get("", summary="被监控项目列表（含最新健康分）")
def list_repos(
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    weights: Annotated[HealthWeights, Depends(health_weights)],
):
    rows = conn.execute(
        "SELECT repo_id, gh_id, owner, name, default_branch, archived FROM dim_repo ORDER BY repo_id"
    ).fetchall()
    data = []
    for row in rows:
        repo_id = row[0]
        snapshot = _latest_snapshot(conn, repo_id)
        health = compute_repo_health(conn, repo_id, weights)
        data.append(
            {
                "id": str(repo_id),
                "owner": row[2],
                "name": row[3],
                "full_name": f"{row[2]}/{row[3]}",
                "default_branch": row[4],
                "archived": row[5],
                "health_score": health["score"],
                "stars": snapshot["stars"],
                "forks": snapshot["forks"],
                "open_issues": snapshot["open_issues"],
                "open_prs": snapshot["open_prs"],
            }
        )
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))


@router.get("/{repo_id}", summary="仓库概览（五维雷达 + 关键指标卡）")
def repo_detail(
    repo_id: str,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    weights: Annotated[HealthWeights, Depends(health_weights)],
):
    repo = resolve_repo(conn, repo_id)
    rid = repo["repo_id"]
    snapshot = _latest_snapshot(conn, rid)
    health = compute_repo_health(conn, rid, weights)
    indicators = get_repo_indicators(conn, rid)
    data = {
        "id": str(rid),
        "owner": repo["owner"],
        "name": repo["name"],
        "full_name": f"{repo['owner']}/{repo['name']}",
        "default_branch": repo["default_branch"],
        "archived": repo["archived"],
        "health": health,
        "key_metrics": {
            "commits_30d": indicators.get("commits", 0),
            "active_contributors_30d": indicators.get("active_contributors", 0),
            "prs_merged_30d": indicators.get("prs_merged", 0),
            "issues_closed_30d": indicators.get("issues_closed", 0),
            "stars": snapshot["stars"],
            "forks": snapshot["forks"],
            "open_issues": snapshot["open_issues"],
            "open_prs": snapshot["open_prs"],
        },
    }
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))


@router.get("/{repo_id}/health", summary="健康度评分时序（?from&to&granularity）")
def repo_health(
    repo_id: str,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    weights: Annotated[HealthWeights, Depends(health_weights)],
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    granularity: str = Query(default="day"),
):
    repo = resolve_repo(conn, repo_id)
    rid = repo["repo_id"]

    end = date.fromisoformat(to) if to else date.today()
    default_start = end - timedelta(days=get_settings().health_window_days - 1)
    start = date.fromisoformat(frm) if frm else default_start
    if start > end:
        start = end

    window_days = get_settings().health_window_days
    series = compute_health_series(
        conn, rid, weights, start=start, end=end, window_days=window_days
    )
    latest = compute_repo_health(conn, rid, weights)
    data = {
        "repo_id": str(rid),
        "granularity": granularity,
        "window_days": window_days,
        "series": series,
        "latest": latest,
    }
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))


_METRIC_SQL = {
    "commits": (
        "SELECT date_trunc('day', committed_at)::date AS d, COUNT(*)::int AS v"
        " FROM fact_commit WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s"
        " GROUP BY d ORDER BY d"
    ),
    "prs": (
        "SELECT date_trunc('day', created_at)::date AS d, COUNT(*)::int AS v"
        " FROM fact_pull_request WHERE repo_id=%s AND created_at > %s AND created_at <= %s"
        " GROUP BY d ORDER BY d"
    ),
    "issues": (
        "SELECT date_trunc('day', created_at)::date AS d, COUNT(*)::int AS v"
        " FROM fact_issue WHERE repo_id=%s AND is_pull_request=false"
        " AND created_at > %s AND created_at <= %s GROUP BY d ORDER BY d"
    ),
    "ci": (
        "SELECT date_trunc('day', started_at)::date AS d, COUNT(*)::int AS v"
        " FROM fact_workflow_run WHERE repo_id=%s AND started_at > %s AND started_at <= %s"
        " GROUP BY d ORDER BY d"
    ),
    "contributors": (
        "SELECT date_trunc('day', committed_at)::date AS d, COUNT(DISTINCT author_id)::int AS v"
        " FROM fact_commit WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s"
        " AND author_id IS NOT NULL GROUP BY d ORDER BY d"
    ),
}


@router.get("/{repo_id}/metrics/{metric}", summary="单指标时序（commits/prs/issues/ci/stars/contributors）")
def repo_metric(
    repo_id: str,
    metric: str,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
):
    repo = resolve_repo(conn, repo_id)
    rid = repo["repo_id"]

    end = date.fromisoformat(to) if to else date.today()
    start = date.fromisoformat(frm) if frm else end - timedelta(days=29)
    end_dt = datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=UTC)
    start_dt = datetime(start.year, start.month, start.day, tzinfo=UTC)

    if metric == "stars":
        rows = conn.execute(
            "SELECT date AS d, stars AS v FROM fact_repo_metric_daily"
            " WHERE repo_id=%s AND date >= %s AND date <= %s ORDER BY date",
            (rid, start, end),
        ).fetchall()
        series = [{"date": r[0].isoformat(), "value": int(r[1])} for r in rows]
    elif metric in _METRIC_SQL:
        rows = conn.execute(_METRIC_SQL[metric], (rid, start_dt, end_dt)).fetchall()
        series = [{"date": r[0].isoformat(), "value": int(r[1])} for r in rows]
    else:
        return api_json(
            None, code=40400, message=f"unknown metric: {metric}", request_id=_rid(request), status_code=404
        )
    return api_json({"metric": metric, "series": series}, code=CODE_OK, message="ok", request_id=_rid(request))


@router.get("/{repo_id}/contributors", summary="贡献者排行")
def repo_contributors(
    repo_id: str,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
):
    repo = resolve_repo(conn, repo_id)
    rid = repo["repo_id"]
    end = date.fromisoformat(to) if to else date.today()
    start = date.fromisoformat(frm) if frm else end - timedelta(days=29)
    end_dt = datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=UTC)
    start_dt = datetime(start.year, start.month, start.day, tzinfo=UTC)

    commits = conn.execute(
        "SELECT c.contributor_id, c.gh_login, c.display_name, c.email_plain, c.email_masked,"
        " COALESCE(o.key, '_unclassified') AS org_key, COALESCE(o.name, '待归类') AS org_name,"
        " COALESCE(b.source, 'inferred') AS org_source,"
        " COALESCE(b.confidence, 0) AS org_confidence,"
        " COUNT(*)::int AS commits,"
        " MIN(fc.committed_at) AS first_seen, MAX(fc.committed_at) AS last_seen"
        " FROM fact_commit fc JOIN dim_contributor c ON c.contributor_id = fc.author_id"
        " LEFT JOIN bridge_contributor_org b"
        "   ON b.contributor_id = c.contributor_id AND b.valid_to IS NULL"
        " LEFT JOIN dim_org o ON o.org_id = b.org_id"
        " WHERE fc.repo_id=%s AND fc.committed_at > %s AND fc.committed_at <= %s"
        " GROUP BY c.contributor_id, c.gh_login, c.display_name, c.email_plain, c.email_masked,"
        "          o.key, o.name, b.source, b.confidence",
        (rid, start_dt, end_dt),
    ).fetchall()
    prs = dict(
        conn.execute(
            "SELECT author_id, COUNT(*)::int FROM fact_pull_request"
            " WHERE repo_id=%s AND created_at > %s AND created_at <= %s"
            " GROUP BY author_id",
            (rid, start_dt, end_dt),
        ).fetchall()
    )
    reviews = dict(
        conn.execute(
            "SELECT reviewer_id, COUNT(*)::int FROM fact_review"
            " WHERE repo_id=%s AND submitted_at > %s AND submitted_at <= %s"
            " GROUP BY reviewer_id",
            (rid, start_dt, end_dt),
        ).fetchall()
    )
    issues = dict(
        conn.execute(
            "SELECT author_id, COUNT(*)::int FROM fact_issue"
            " WHERE repo_id=%s AND is_pull_request=false"
            " AND created_at > %s AND created_at <= %s"
            " GROUP BY author_id",
            (rid, start_dt, end_dt),
        ).fetchall()
    )
    wiki = dict(
        conn.execute(
            "SELECT author_id, COUNT(*)::int FROM fact_wiki_revision"
            " WHERE repo_id=%s AND committed_at > %s AND committed_at <= %s"
            " GROUP BY author_id",
            (rid, start_dt, end_dt),
        ).fetchall()
    )
    code_add: dict[int, int] = {}
    code_del: dict[int, int] = {}
    for r in conn.execute(
        "SELECT author_id, SUM(additions)::int, SUM(deletions)::int"
        " FROM fact_contributor_code_weekly"
        " WHERE repo_id=%s AND week_start >= %s AND week_start <= %s GROUP BY author_id",
        (rid, start, end),
    ).fetchall():
        code_add[int(r[0])] = int(r[1])
        code_del[int(r[0])] = int(r[2])

    data = []
    for row in commits:
        cid = int(row[0])
        additions = int(code_add.get(cid, 0))
        deletions = int(code_del.get(cid, 0))
        data.append(
            {
                "login": row[1],
                "contributor_id": str(cid),
                "avatar_url": f"https://github.com/{row[1]}.png" if row[1] else None,
                # email 取明文 email_plain（需求方 2026-09-22 拍板），脱敏形另立 email_masked。
                "email": row[3] if row[3] else None,
                "email_masked": row[4],
                "org": {
                    "key": row[5],
                    "display": row[6],
                    "source": row[7],
                    "confidence": float(row[8]) if row[8] is not None else None,
                },
                "commits": row[9],
                "prs": int(prs.get(cid, 0)),
                "reviews": int(reviews.get(cid, 0)),
                "issues": int(issues.get(cid, 0)),
                "wiki": int(wiki.get(cid, 0)),
                "code_additions": additions,
                "code_deletions": deletions,
                "code_total": additions + deletions,
                "first_seen": row[10].isoformat() if row[10] else None,
                "last_seen": row[11].isoformat() if row[11] else None,
            }
        )
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))