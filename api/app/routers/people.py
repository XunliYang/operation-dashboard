"""看板 B · 人员组织分类路由（LEOY-6 · Phase 2）。

端点（nginx 已剥掉 `/rest/v1` 前缀）：
  GET  /dashboard/orgs                     组织树 + 分层 + 停滞告警 + 待归类
  GET  /dashboard/orgs/{org_id}/members    单个组织的成员列表
  GET  /dashboard/contributors/{id}        人员画像（邮箱默认脱敏）
  POST /admin/identity-merge               身份归并确认 / 拒绝

响应统一走 `{code,message,data,request_id}`。邮箱只读 `dim_contributor.email_masked`，
绝不回吐明文（明文在本系统中本就不落库）。
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg import Connection
from pydantic import BaseModel

from app.core.response import CODE_OK, api_json
from app.routers.deps import db_conn
from app.services.people import (
    MERGE_CONFIRMED,
    MERGE_REJECTED,
    MemberRow,
    OrgRow,
    build_org_board,
)

router = APIRouter(prefix="/dashboard", tags=["people"])
admin_router = APIRouter(prefix="/admin", tags=["people-admin"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


# ---------------------------------------------------------------------------
# 内部：装载看板所需的组织 / 成员 / 贡献 / 归并数据
# ---------------------------------------------------------------------------


def _load_board(conn: Connection) -> dict:
    org_rows = [
        OrgRow(r[0], r[1], r[2], r[3], r[4])
        for r in conn.execute(
            "SELECT org_id, name, kind, source, parent_id FROM dim_org ORDER BY org_id"
        ).fetchall()
    ]

    raw_members = conn.execute(
        "SELECT c.contributor_id, c.gh_login, c.email_masked, c.last_seen_at,"
        "       b.org_id, b.role, b.confidence, b.source"
        " FROM dim_contributor c"
        " LEFT JOIN bridge_contributor_org b"
        "   ON b.contributor_id = c.contributor_id AND b.valid_to IS NULL"
        " ORDER BY c.contributor_id"
    ).fetchall()

    commits = dict(
        conn.execute(
            "SELECT author_id, COUNT(*)::int FROM fact_commit"
            " WHERE committed_at > now() - interval '90 days' AND author_id IS NOT NULL"
            " GROUP BY author_id"
        ).fetchall()
    )
    prs = dict(
        conn.execute(
            "SELECT author_id, COUNT(*)::int FROM fact_pull_request"
            " WHERE created_at > now() - interval '90 days' AND author_id IS NOT NULL"
            " GROUP BY author_id"
        ).fetchall()
    )
    reviews = dict(
        conn.execute(
            "SELECT reviewer_id, COUNT(*)::int FROM fact_review"
            " WHERE submitted_at > now() - interval '90 days' AND reviewer_id IS NOT NULL"
            " GROUP BY reviewer_id"
        ).fetchall()
    )

    members: list[MemberRow] = []
    for r in raw_members:
        cid = r[0]
        members.append(
            MemberRow(
                contributor_id=cid,
                login=r[1],
                email_masked=r[2],
                last_seen_at=r[3],
                org_id=r[4],
                role=r[5],
                confidence=float(r[6]) if r[6] is not None else None,
                source=r[7],
                contributions=int(commits.get(cid, 0) + prs.get(cid, 0) + reviews.get(cid, 0)),
            )
        )

    merges = conn.execute(
        "SELECT canonical_id, merged_id, status FROM identity_merge"
    ).fetchall()

    return build_org_board(org_rows, members, merges)


def _find_org_node(orgs: list[dict], org_id: str) -> dict | None:
    for node in orgs:
        if node["id"] == org_id:
            return node
        found = _find_org_node(node.get("teams", []), org_id)
        if found is not None:
            return found
    return None


# ---------------------------------------------------------------------------
# 组织树
# ---------------------------------------------------------------------------


@router.get("/orgs", summary="组织树 + 活跃度分层 + 停滞告警 + 待归类")
def list_orgs(request: Request, conn: Annotated[Connection, Depends(db_conn)]):
    return api_json(_load_board(conn), code=CODE_OK, message="ok", request_id=_rid(request))


@router.get("/orgs/{org_id}/members", summary="单个组织的成员列表")
def org_members(
    org_id: int,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
):
    board = _load_board(conn)
    node = _find_org_node(board["orgs"], str(org_id))
    if node is None:
        raise HTTPException(status_code=404, detail=f"org not found: {org_id}")
    data = {
        "id": node["id"],
        "name": node["name"],
        "kind": node["kind"],
        "member_count": node["member_count"],
        "contribution_share": node["contribution_share"],
        "members": node["members"],
    }
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))


# ---------------------------------------------------------------------------
# 人员画像
# ---------------------------------------------------------------------------


@router.get("/contributors/{contributor_id}", summary="人员画像（邮箱默认脱敏）")
def contributor_detail(
    contributor_id: int,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
):
    row = conn.execute(
        "SELECT contributor_id, gh_login, display_name, email_masked, company_raw,"
        "       first_seen_at, last_seen_at"
        " FROM dim_contributor WHERE contributor_id = %s",
        (contributor_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"contributor not found: {contributor_id}")

    orgs = conn.execute(
        "SELECT o.org_id, o.name, o.kind, b.role, b.confidence, b.source"
        " FROM bridge_contributor_org b"
        " JOIN dim_org o ON o.org_id = b.org_id"
        " WHERE b.contributor_id = %s AND b.valid_to IS NULL"
        " ORDER BY b.confidence DESC",
        (contributor_id,),
    ).fetchall()

    repos = conn.execute(
        "SELECT DISTINCT r.repo_id, r.owner, r.name"
        " FROM fact_commit fc"
        " JOIN dim_repo r ON r.repo_id = fc.repo_id"
        " WHERE fc.author_id = %s"
        " ORDER BY r.owner, r.name",
        (contributor_id,),
    ).fetchall()

    commits = conn.execute(
        "SELECT COUNT(*)::int FROM fact_commit WHERE author_id = %s", (contributor_id,)
    ).fetchone()[0]
    prs = conn.execute(
        "SELECT COUNT(*)::int FROM fact_pull_request WHERE author_id = %s", (contributor_id,)
    ).fetchone()[0]
    reviews = conn.execute(
        "SELECT COUNT(*)::int FROM fact_review WHERE reviewer_id = %s", (contributor_id,)
    ).fetchone()[0]

    email_masked = row[3]
    data = {
        "id": str(row[0]),
        "login": row[1],
        "display_name": row[2],
        # 默认脱敏：优先输出落库时已脱敏的展示形；缺失时以占位符兜底，绝不回吐明文。
        "email": email_masked if email_masked else None,
        "company": row[4],
        "first_seen_at": row[5].isoformat() if row[5] else None,
        "last_seen_at": row[6].isoformat() if row[6] else None,
        "orgs": [
            {
                "org_id": str(o[0]),
                "name": o[1],
                "kind": o[2],
                "role": o[3],
                "confidence": float(o[4]),
                "source": o[5],
            }
            for o in orgs
        ],
        "repos": [{"id": str(r[0]), "full_name": f"{r[1]}/{r[2]}"} for r in repos],
        "activity": {
            "commits": commits,
            "prs": prs,
            "reviews": reviews,
        },
    }
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))


# ---------------------------------------------------------------------------
# 身份归并（人工确认 / 拒绝）
# ---------------------------------------------------------------------------


class IdentityMergeRequest(BaseModel):
    merge_id: int
    action: Literal["confirm", "reject"]


@admin_router.post("/identity-merge", summary="身份归并确认 / 拒绝")
def resolve_identity_merge(
    body: IdentityMergeRequest,
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
):
    status = MERGE_CONFIRMED if body.action == "confirm" else MERGE_REJECTED
    row = conn.execute(
        "UPDATE identity_merge SET status = %s, resolved_at = now()"
        " WHERE merge_id = %s AND status = 'pending'"
        " RETURNING merge_id, canonical_id, merged_id, status",
        (status, body.merge_id),
    ).fetchone()

    if row is None:
        existing = conn.execute(
            "SELECT status FROM identity_merge WHERE merge_id = %s", (body.merge_id,)
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail=f"merge not found: {body.merge_id}")
        return api_json(
            {
                "merge_id": body.merge_id,
                "status": existing[0],
                "changed": False,
            },
            code=40000,
            message=f"merge already resolved ({existing[0]})",
            request_id=_rid(request),
            status_code=409,
        )

    conn.commit()
    return api_json(
        {
            "merge_id": row[0],
            "canonical_id": str(row[1]),
            "merged_id": str(row[2]),
            "status": row[3],
            "changed": True,
        },
        code=CODE_OK,
        message="ok",
        request_id=_rid(request),
    )