"""看板 · 工作台路由（LEOY-12 · Phase 1.7，只读聚合，不改任何采集/评分）。

端点（nginx 已剥掉 `/rest/v1` 前缀）：
  GET /dashboard/workbench?org=openan&window=7d

响应统一走 `{code,message,data,request_id}`。data 含六项指标 + `lists` 明细清单
（供 ListCard 渲染）+ `thresholds`（回显生效阈值），口径全部可复现。

每个指标依赖的 SQL 与表：

  stalled_repos（fact_commit + dim_repo）
      SELECT repo_id, MAX(committed_at) FROM fact_commit
      WHERE repo_id = ANY(%s) GROUP BY repo_id
      —— 启用仓库中无提交或最近提交距今 > window_days 天者计入。

  health_drops（agg_health_score_daily）
      SELECT repo_id, date, score FROM agg_health_score_daily
      WHERE repo_id = ANY(%s) AND dimension = %s AND date >= %s
      —— 取 composite 维度窗口内最早/最晚分，跌幅 = 最早 − 最晚，TOP N。

  review_backlog（fact_pull_request）
      SELECT pr.repo_id, r.owner, r.name, pr.pr_number, pr.title,
             pr.created_at, pr.first_review_at
      FROM fact_pull_request pr JOIN dim_repo r ON r.repo_id = pr.repo_id
      WHERE pr.repo_id = ANY(%s) AND pr.state = 'open'
      —— 打开且 first_review_at IS NULL、创建距今 > review_backlog_days 天者计入。

  unlinked_prs（fact_pull_request，标题近似口径）
      复用 review_backlog 的同一批 open PR，标题无 `#[0-9]+` 者计入。

  slow_issue_response（fact_issue）
      SELECT repo_id, EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP
        (ORDER BY (closed_at - created_at))) / 3600.0
      FROM fact_issue WHERE repo_id = ANY(%s)
        AND is_pull_request = false AND closed_at IS NOT NULL GROUP BY repo_id
      —— 按仓库取 issue 关闭时长中位数（「首响」近似口径），> slow_response_hours 者计入。

  unclassified_people（bridge_contributor_org）
      SELECT COUNT(DISTINCT contributor_id) FROM bridge_contributor_org
      WHERE source = 'inferred' AND confidence = 0 AND valid_to IS NULL
      —— Phase 2 尚未写入分类数据（桥表空）时返回 null。
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg import Connection

from app.core.config import get_settings
from app.core.response import CODE_OK, api_json
from app.routers.deps import db_conn
from app.services.org_classifier import load_org_mapping
from app.services.workbench import (
    HealthScoreRow,
    IssueResponseRow,
    MergeRow,
    OpenPrRow,
    RepoRow,
    build_workbench,
    load_workbench_config,
)

router = APIRouter(prefix="/dashboard", tags=["workbench"])

_ORG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _parse_window(raw: str | None, default: int) -> int:
    """把 `window=7d` 解析为天数；空值用默认；非法或 <1 天抛 400。"""
    if raw is None or raw.strip() == "":
        return default
    m = re.fullmatch(r"(\d+)\s*(?:d|days?)?", raw.strip().lower())
    if not m:
        raise HTTPException(status_code=400, detail=f"invalid window: {raw!r} (expected e.g. '7d')")
    days = int(m.group(1))
    if days < 1:
        raise HTTPException(status_code=400, detail="window must be >= 1 day")
    return days


def _load_org_repos(config_dir: str) -> dict[str, set[str]]:
    """org key -> set('owner/name')，来自 config/org_mapping.yaml（含仓库根回退）。"""
    for d in (Path(config_dir), Path(__file__).resolve().parents[3] / "config"):
        path = d / "org_mapping.yaml"
        if path.is_file():
            mapping = load_org_mapping(str(d))
            return {key: set(spec.repos) for key, spec in mapping.orgs.items()}
    return {}


def _resolve_scope(config_dir: str, org: str | None) -> set[str] | None:
    """org -> 仓库全名集合；None 表示不限组织。非法/未知 org 抛 400。"""
    if org is None or org.strip() == "":
        return None
    org = org.strip()
    if not _ORG_RE.fullmatch(org):
        raise HTTPException(status_code=400, detail=f"invalid org: {org!r}")
    org_repos = _load_org_repos(config_dir)
    if org not in org_repos:
        raise HTTPException(status_code=400, detail=f"unknown org: {org!r}")
    return org_repos[org]


@router.get("/workbench", summary="工作台预警看板（停滞/积压/健康度下滑）")
def workbench(
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    org: str | None = Query(default=None, description="组织键（如 openan），需存在于 org_mapping.yaml"),
    window: str | None = Query(default=None, description="滚动窗口，如 7d / 14d"),
):
    settings = get_settings()
    config = load_workbench_config(settings.config_dir)
    window_days = _parse_window(window, config.window_days)
    scope = _resolve_scope(settings.config_dir, org)
    as_of = datetime.now(UTC)

    repo_rows = conn.execute(
        "SELECT repo_id, owner, name, archived FROM dim_repo"
    ).fetchall()
    repos = [RepoRow(r[0], r[1], r[2], bool(r[3])) for r in repo_rows]

    scoped = [
        r
        for r in repos
        if not r.archived and (scope is None or f"{r.owner}/{r.name}" in scope)
    ]
    scoped_ids = [r.repo_id for r in scoped]

    last_commit_by_repo: dict[int, datetime] = {}
    health_score_rows: list[HealthScoreRow] = []
    open_prs: list[OpenPrRow] = []
    issue_response_rows: list[IssueResponseRow] = []
    unclassified_count: int | None = None
    merges: list[MergeRow] = []

    if scoped_ids:
        for row in conn.execute(
            "SELECT repo_id, MAX(committed_at) FROM fact_commit"
            " WHERE repo_id = ANY(%s) GROUP BY repo_id",
            (scoped_ids,),
        ).fetchall():
            if row[1] is not None:
                last_commit_by_repo[int(row[0])] = row[1]

        start_date = (as_of - timedelta(days=window_days)).date()
        for row in conn.execute(
            "SELECT repo_id, date, score FROM agg_health_score_daily"
            " WHERE repo_id = ANY(%s) AND dimension = %s AND date >= %s",
            (scoped_ids, config.health_drop_dimension, start_date),
        ).fetchall():
            health_score_rows.append(
                HealthScoreRow(int(row[0]), row[1], float(row[2]))
            )

        for row in conn.execute(
            "SELECT pr.repo_id, r.owner, r.name, pr.pr_number, pr.title,"
            "       pr.created_at, pr.first_review_at"
            " FROM fact_pull_request pr JOIN dim_repo r ON r.repo_id = pr.repo_id"
            " WHERE pr.repo_id = ANY(%s) AND pr.state = 'open'",
            (scoped_ids,),
        ).fetchall():
            open_prs.append(
                OpenPrRow(
                    repo_id=int(row[0]),
                    owner=row[1],
                    name=row[2],
                    pr_number=int(row[3]),
                    title=row[4],
                    created_at=row[5],
                    first_review_at=row[6],
                )
            )

        for row in conn.execute(
            "SELECT pr.repo_id, r.owner, r.name, pr.pr_number, pr.title, pr.merged_at"
            " FROM fact_pull_request pr JOIN dim_repo r ON r.repo_id = pr.repo_id"
            " WHERE pr.repo_id = ANY(%s) AND pr.merged_at IS NOT NULL",
            (scoped_ids,),
        ).fetchall():
            merges.append(
                MergeRow(
                    repo_id=int(row[0]),
                    owner=row[1],
                    name=row[2],
                    pr_number=int(row[3]),
                    title=row[4],
                    merged_at=row[5],
                )
            )

        for row in conn.execute(
            "SELECT repo_id, EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP"
            " (ORDER BY (closed_at - created_at))) / 3600.0 AS median_hours"
            " FROM fact_issue WHERE repo_id = ANY(%s)"
            " AND is_pull_request = false AND closed_at IS NOT NULL"
            " GROUP BY repo_id",
            (scoped_ids,),
        ).fetchall():
            # 让仓库全名也随行返回，供清单卡展示
            owner = next((r.owner for r in scoped if r.repo_id == int(row[0])), "")
            name = next((r.name for r in scoped if r.repo_id == int(row[0])), "")
            issue_response_rows.append(
                IssueResponseRow(int(row[0]), owner, name, float(row[1]))
            )

    # unclassified_people：Phase 2 尚未迁移（bridge_contributor_org 不存在）或桥表为空
    # → 返回 null，不阻塞本 issue，也不 500。用 to_regclass 显式判断表是否存在。
    try:
        bridge_exists = bool(
            conn.execute("SELECT to_regclass('bridge_contributor_org') IS NOT NULL").fetchone()[0]
        )
        if bridge_exists:
            bridge_total = int(conn.execute("SELECT COUNT(*) FROM bridge_contributor_org").fetchone()[0])
            if bridge_total > 0:
                unclassified_count = int(
                    conn.execute(
                        "SELECT COUNT(DISTINCT contributor_id) FROM bridge_contributor_org"
                        " WHERE source = 'inferred' AND confidence = 0 AND valid_to IS NULL"
                    ).fetchone()[0]
                )
    except Exception:  # pragma: no cover - 兜底：任何异常都降级为 null，绝不 500
        unclassified_count = None

    data = build_workbench(
        org=org,
        repos=scoped,
        last_commit_by_repo=last_commit_by_repo,
        health_score_rows=health_score_rows,
        open_prs=open_prs,
        issue_response_rows=issue_response_rows,
        unclassified_count=unclassified_count,
        merges=merges,
        config=config,
        as_of=as_of,
    )
    # window 查询参数覆盖后的生效值以响应为准（config.window_days 可能被覆盖）。
    data["window_days"] = window_days
    data["thresholds"]["window_days"] = window_days
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))
