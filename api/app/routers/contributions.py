"""贡献度聚合路由（LEOY-48 · 贡献度 S2）。

端点（nginx 已剥掉 `/rest/v1` 前缀）：

  GET /dashboard/contributions/summary?group_by=org|repo&metric=...&org=&repo=&from=&to=
      贡献度按组织/仓库两维度汇总，五口径各自给详情，支持按组织（成员）/仓库/时间窗筛选。

  GET /dashboard/contributions/leaderboard?dimension=org|repo|project&scope=&metric=...&from=&to=&limit=&offset=
      组织 / 仓库 / 整个项目三维度的贡献者排名。

响应统一走 `{code,message,data,request_id}`。

SQL 口径（与表一一对应，改动须与 `services/contributions.py` 的 docstring 同步）：

  commits  fact_commit JOIN dim_contributor ON author_id，窗口筛 committed_at（含 merge）
  prs      fact_pull_request JOIN dim_contributor ON author_id，窗口筛 created_at
  issues   fact_issue WHERE is_pull_request=false，窗口筛 created_at（必须排除 PR）
  code     fact_contributor_code_weekly，窗口筛 week_start（DATE，闭区间），SUM(additions)/SUM(deletions)
  wiki     fact_wiki_revision，窗口筛 committed_at；author_id IS NULL 的行不进个人排名，单独计数并入 summary 的 totals.metric_value（只计总量）
  org_key  bridge_contributor_org（valid_to IS NULL）+ dim_org.key，缺行 → _unclassified
  email    dim_contributor.email_plain（明文，需求方 2026-09-22 决策）
  email_masked dim_contributor.email_masked（脱敏形，保留）
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg import Connection

from app.core.config import get_settings
from app.core.response import CODE_OK, api_json
from app.routers.deps import db_conn, resolve_repo
from app.services.contributions import (
    ContributionRow,
    build_leaderboard,
    normalize_metric,
    summarize,
)
from app.services.org_classifier import UNCLASSIFIED_KEY, UNCLASSIFIED_NAME

router = APIRouter(prefix="/dashboard/contributions", tags=["contributions"])

_GROUP_BYS = ("org", "repo")
_DIMENSIONS = ("org", "repo", "project")

DEFAULT_LIMIT = 50
MAX_LIMIT = 500


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


# ---------------------------------------------------------------------------
# 仓库 / 组织 / 时间窗解析
# ---------------------------------------------------------------------------


def _parse_date(raw: str | None, field: str) -> date | None:
    if raw is None or raw.strip() == "":
        return None
    try:
        return date.fromisoformat(raw.strip())
    except ValueError as exc:  # noqa: PERF203
        raise _bad_request(f"invalid {field}: {raw!r} (expected YYYY-MM-DD)") from exc


def _tracked_full_names(config_dir: str) -> set[str]:
    """启用（enabled=true）的追踪仓库全名；配置缺失时返回空集。"""
    for d in (Path(config_dir), Path(__file__).resolve().parents[3] / "config"):
        path = d / "tracked_repos.yaml"
        if path.is_file():
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            return {r["repo"] for r in raw.get("repos", []) if r.get("enabled", True)}
    return set()


def _scope(conn: Connection, config_dir: str, repo_ref: dict | None) -> tuple[list[int], list[dict]]:
    """返回 (repo_ids, repo_catalog)。repo_ref 为已解析的单个仓库，否则取全部启用仓库。"""
    if repo_ref is not None:
        return [repo_ref["repo_id"]], [
            {
                "id": str(repo_ref["repo_id"]),
                "name": repo_ref["name"],
                "full_name": f"{repo_ref['owner']}/{repo_ref['name']}",
            }
        ]
    full_names = _tracked_full_names(config_dir)
    rows = conn.execute("SELECT repo_id, owner, name FROM dim_repo ORDER BY repo_id").fetchall()
    ids: list[int] = []
    catalog: list[dict] = []
    for r in rows:
        full_name = f"{r[1]}/{r[2]}"
        if full_name in full_names:
            ids.append(r[0])
            catalog.append({"id": str(r[0]), "name": r[2], "full_name": full_name})
    return ids, catalog


def _resolve_org(conn: Connection, key: str, *, missing_status: int) -> str:
    row = conn.execute("SELECT key FROM dim_org WHERE key = %s", (key,)).fetchone()
    if row is None:
        raise HTTPException(status_code=missing_status, detail=f"org not found: {key}")
    return row[0]


# ---------------------------------------------------------------------------
# 行装载（一次全量行 + Python 分桶，避免 N+1）
# ---------------------------------------------------------------------------


def _load_rows(
    conn: Connection,
    *,
    repo_ids: list[int],
    repo_map: dict[int, dict],
    org_key: str | None,
    frm: date | None,
    to: date | None,
) -> tuple[list[ContributionRow], int]:
    if not repo_ids:
        return [], 0

    start_dt = datetime(frm.year, frm.month, frm.day, tzinfo=UTC) if frm else None
    end_dt = datetime(to.year, to.month, to.day, 23, 59, 59, tzinfo=UTC) if to else None

    # 贡献者身份 + 组织（一次读取；org 过滤在此裁剪）
    meta: dict[int, dict] = {}
    for r in conn.execute(
        "SELECT c.contributor_id, c.gh_login, c.display_name, c.email_plain, c.email_masked,"
        "       c.first_seen_at, c.last_seen_at,"
        "       COALESCE(o.key, %s), COALESCE(o.name, %s),"
        "       COALESCE(b.source, %s), COALESCE(b.confidence, 0)"
        " FROM dim_contributor c"
        " LEFT JOIN bridge_contributor_org b"
        "   ON b.contributor_id = c.contributor_id AND b.valid_to IS NULL"
        " LEFT JOIN dim_org o ON o.org_id = b.org_id",
        (UNCLASSIFIED_KEY, UNCLASSIFIED_NAME, "inferred"),
    ).fetchall():
        cid = int(r[0])
        if org_key is not None and r[7] != org_key:
            continue
        meta[cid] = {
            "login": r[1],
            "display_name": r[2],
            "email": r[3],
            "email_masked": r[4],
            "first_seen_at": r[5].isoformat() if r[5] else None,
            "last_seen_at": r[6].isoformat() if r[6] else None,
            "org_key": r[7],
            "org_display": r[8],
            "org_source": r[9],
            "org_confidence": float(r[10]) if r[10] is not None else None,
        }

    # 五口径原始计数，逐 (contributor, repo) 分桶
    slots: dict[tuple[int, int], dict[str, float]] = {}

    def _add(rows, key: str, value_idx: int = 2) -> None:
        for r in rows:
            cid = int(r[0])
            if cid not in meta:
                continue
            slots.setdefault((cid, int(r[1])), {})[key] = float(r[value_idx])

    _add(
        conn.execute(
            "SELECT author_id, repo_id, COUNT(*)::int FROM fact_commit"
            " WHERE author_id IS NOT NULL AND repo_id = ANY(%s)"
            + (" AND committed_at > %s" if start_dt else "")
            + (" AND committed_at <= %s" if end_dt else "")
            + " GROUP BY author_id, repo_id",
            tuple(
                p
                for p in (repo_ids, start_dt, end_dt)
                if p is not None
            ),
        ).fetchall(),
        "commits",
    )
    _add(
        conn.execute(
            "SELECT author_id, repo_id, COUNT(*)::int FROM fact_pull_request"
            " WHERE author_id IS NOT NULL AND repo_id = ANY(%s)"
            + (" AND created_at > %s" if start_dt else "")
            + (" AND created_at <= %s" if end_dt else "")
            + " GROUP BY author_id, repo_id",
            tuple(
                p
                for p in (repo_ids, start_dt, end_dt)
                if p is not None
            ),
        ).fetchall(),
        "prs",
    )
    _add(
        conn.execute(
            "SELECT author_id, repo_id, COUNT(*)::int FROM fact_issue"
            " WHERE author_id IS NOT NULL AND is_pull_request = false AND repo_id = ANY(%s)"
            + (" AND created_at > %s" if start_dt else "")
            + (" AND created_at <= %s" if end_dt else "")
            + " GROUP BY author_id, repo_id",
            tuple(
                p
                for p in (repo_ids, start_dt, end_dt)
                if p is not None
            ),
        ).fetchall(),
        "issues",
    )
    # code 周桶：week_start 为 DATE，闭区间（>= from AND <= to）
    code_where = " AND week_start >= %s" if frm else ""
    code_where += " AND week_start <= %s" if to else ""
    for r in conn.execute(
        "SELECT author_id, repo_id, SUM(additions)::int, SUM(deletions)::int"
        " FROM fact_contributor_code_weekly"
        " WHERE author_id IS NOT NULL AND repo_id = ANY(%s)" + code_where
        + " GROUP BY author_id, repo_id",
        tuple(
            p
            for p in (repo_ids, frm, to)
            if p is not None
        ),
    ).fetchall():
        cid = int(r[0])
        if cid not in meta:
            continue
        slot = slots.setdefault((cid, int(r[1])), {})
        slot["code_additions"] = float(r[2])
        slot["code_deletions"] = float(r[3])
    _add(
        conn.execute(
            "SELECT author_id, repo_id, COUNT(*)::int FROM fact_wiki_revision"
            " WHERE author_id IS NOT NULL AND repo_id = ANY(%s)"
            + (" AND committed_at > %s" if start_dt else "")
            + (" AND committed_at <= %s" if end_dt else "")
            + " GROUP BY author_id, repo_id",
            tuple(
                p
                for p in (repo_ids, start_dt, end_dt)
                if p is not None
            ),
        ).fetchall(),
        "wiki",
    )

    # 无归属（author_id IS NULL）wiki 修订：只计入口径总量、不进个人排名（LEOY-48 契约）。
    wiki_row = (
        conn.execute(
            "SELECT COUNT(*)::int FROM fact_wiki_revision"
            " WHERE author_id IS NULL AND repo_id = ANY(%s)"
            + (" AND committed_at > %s" if start_dt else "")
            + (" AND committed_at <= %s" if end_dt else ""),
            tuple(
                p
                for p in (repo_ids, start_dt, end_dt)
                if p is not None
            ),
        ).fetchone()
    )
    unattributed_wiki = int(wiki_row[0]) if wiki_row else 0

    rows: list[ContributionRow] = []
    for (cid, rid), metrics in slots.items():
        m = meta[cid]
        repo = repo_map.get(rid, {})
        rows.append(
            ContributionRow(
                contributor_id=cid,
                login=m["login"],
                email=m["email"],
                email_masked=m["email_masked"],
                org_key=m["org_key"],
                metrics=metrics,
                display_name=m["display_name"],
                org_display=m["org_display"],
                org_source=m["org_source"],
                org_confidence=m["org_confidence"],
                first_seen_at=m["first_seen_at"],
                last_seen_at=m["last_seen_at"],
                repo_id=rid,
                repo_name=repo.get("name"),
                repo_full_name=repo.get("full_name"),
            )
        )
    return rows, unattributed_wiki


def _repo_map(conn: Connection, repo_ids: list[int]) -> dict[int, dict]:
    if not repo_ids:
        return {}
    return {
        int(r[0]): {"name": r[2], "full_name": f"{r[1]}/{r[2]}"}
        for r in conn.execute(
            "SELECT repo_id, owner, name FROM dim_repo WHERE repo_id = ANY(%s)",
            (repo_ids,),
        ).fetchall()
    }


# ---------------------------------------------------------------------------
# 契约 A：贡献度汇总
# ---------------------------------------------------------------------------


@router.get("/summary", summary="贡献度汇总（组织 / 仓库两维度，五口径筛选）")
def contributions_summary(
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    group_by: str = Query(..., description="org | repo"),
    metric: str | None = Query(default=None, description="prs|commits|code|issues|wiki"),
    org: str | None = Query(default=None, description="组织键（成员过滤）"),
    repo: str | None = Query(default=None, description="repo_id 或 owner/name"),
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
):
    try:
        group_by = group_by.strip().lower()
        if group_by not in _GROUP_BYS:
            raise ValueError(f"invalid group_by: {group_by!r}")
        metric = normalize_metric(metric)
    except ValueError as exc:
        raise _bad_request(str(exc)) from exc

    frm_d = _parse_date(frm, "from")
    to_d = _parse_date(to, "to")

    repo_ref = resolve_repo(conn, repo) if repo else None
    org_key = _resolve_org(conn, org, missing_status=400) if org else None

    settings = get_settings()
    repo_ids, catalog = _scope(conn, settings.config_dir, repo_ref)
    rows, unattributed_wiki = _load_rows(
        conn,
        repo_ids=repo_ids,
        repo_map=_repo_map(conn, repo_ids),
        org_key=org_key,
        frm=frm_d,
        to=to_d,
    )
    data = summarize(
        rows,
        group_by=group_by,
        metric=metric,
        range_={"from": frm_d.isoformat() if frm_d else None,
                "to": to_d.isoformat() if to_d else None},
        filters={"org": org, "repo": repo},
        repo_catalog=catalog,
        unattributed_wiki=unattributed_wiki,
    )
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))


# ---------------------------------------------------------------------------
# 契约 B：贡献者排名
# ---------------------------------------------------------------------------


@router.get("/leaderboard", summary="贡献者排名（组织 / 仓库 / 整个项目三维度）")
def contributions_leaderboard(
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    dimension: str = Query(..., description="org|repo|project"),
    scope: str | None = Query(default=None, description="org 键或 repo_id（project 时省略）"),
    metric: str | None = Query(default=None, description="prs|commits|code|issues|wiki"),
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
):
    try:
        dimension = dimension.strip().lower()
        if dimension not in _DIMENSIONS:
            raise ValueError(f"invalid dimension: {dimension!r}")
    except ValueError as exc:
        raise _bad_request(str(exc)) from exc

    if dimension in ("org", "repo") and (scope is None or scope.strip() == ""):
        raise _bad_request(f"dimension={dimension} requires scope")

    # 先解析 scope（404 优先于 metric 校验，见验收错误语义）
    scope_arg = (scope or "").strip()
    repo_ref: dict | None = None
    org_key: str | None = None
    scope_value: str | None = None
    if dimension == "repo":
        repo_ref = resolve_repo(conn, scope_arg)  # 不存在 → 404
        scope_value = scope_arg
    elif dimension == "org":
        org_key = _resolve_org(conn, scope_arg, missing_status=404)
        scope_value = scope_arg
    # project：scope 忽略，覆盖全部启用仓库

    try:
        metric = normalize_metric(metric)
    except ValueError as exc:
        raise _bad_request(str(exc)) from exc

    frm_d = _parse_date(frm, "from")
    to_d = _parse_date(to, "to")

    settings = get_settings()
    repo_ids, _catalog = _scope(conn, settings.config_dir, repo_ref)
    rows, _unattributed_wiki = _load_rows(
        conn,
        repo_ids=repo_ids,
        repo_map=_repo_map(conn, repo_ids),
        org_key=org_key,
        frm=frm_d,
        to=to_d,
    )
    data = build_leaderboard(
        rows,
        dimension=dimension,
        scope=scope_value,
        metric=metric,
        range_={"from": frm_d.isoformat() if frm_d else None,
                "to": to_d.isoformat() if to_d else None},
        limit=limit,
        offset=offset,
    )
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))
