"""管理路由（`/admin`）：手动触发采集与采集运行历史。

`POST /admin/collect` 只创建 `collect_run(status=queued)` 并返回 run_id，实际采集由
collector 的兜底 job 消费 queued 记录后执行：`full_backfill=false` 走增量（since
游标 + pulls 早停），`full_backfill=true` 走有界回填（忽略增量游标、按 `max_pages`
上限重拉，重配额操作，默认关闭）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from psycopg import Connection
from pydantic import BaseModel

from app.core.response import CODE_OK, api_json
from app.routers.deps import db_conn, resolve_repo

router = APIRouter(prefix="/admin", tags=["admin"])


class CollectRequest(BaseModel):
    repo: str | None = None          # "owner/name"；缺省表示全部追踪仓库
    # true 触发有界回填：忽略增量游标、按 max_pages 上限重拉（重配额操作，默认关闭）；
    # false 走增量 github_incremental（since 游标 + pulls 早停）。
    full_backfill: bool = False


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


@router.post("/collect", summary="手动触发采集（返回 queued run_id）")
def trigger_collect(
    body: CollectRequest, request: Request, conn: Annotated[Connection, Depends(db_conn)]
):
    job = "github_backfill" if body.full_backfill else "github_incremental"
    repo_id = None
    if body.repo:
        repo = resolve_repo(conn, body.repo)
        repo_id = repo["repo_id"]

    row = conn.execute(
        "INSERT INTO collect_run (job, repo_id, status) VALUES (%s, %s, 'queued')"
        " RETURNING run_id",
        (job, repo_id),
    ).fetchone()
    conn.commit()
    return api_json(
        {"run_id": row[0], "job": job, "repo_id": repo_id, "status": "queued"},
        code=CODE_OK,
        message="ok",
        request_id=_rid(request),
    )


@router.get("/collect-runs", summary="采集运行历史与配额余量")
def list_collect_runs(
    request: Request,
    conn: Annotated[Connection, Depends(db_conn)],
    limit: int = 50,
    job: str | None = None,
):
    limit = max(1, min(limit, 200))
    if job:
        rows = conn.execute(
            "SELECT run_id, job, repo_id, cursor, status, started_at, finished_at,"
            " rate_limit_remaining, error FROM collect_run WHERE job = %s"
            " ORDER BY run_id DESC LIMIT %s",
            (job, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT run_id, job, repo_id, cursor, status, started_at, finished_at,"
            " rate_limit_remaining, error FROM collect_run ORDER BY run_id DESC LIMIT %s",
            (limit,),
        ).fetchall()
    data = [
        {
            "run_id": r[0],
            "job": r[1],
            "repo_id": r[2],
            "cursor": r[3],
            "status": r[4],
            "started_at": r[5].isoformat() if r[5] else None,
            "finished_at": r[6].isoformat() if r[6] else None,
            "rate_limit_remaining": r[7],
            "error": r[8],
        }
        for r in rows
    ]
    return api_json(data, code=CODE_OK, message="ok", request_id=_rid(request))