"""路由层依赖：DB 连接 / 权重配置 / 仓库解析。"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import HTTPException
from psycopg import Connection, OperationalError
from psycopg_pool import PoolTimeout

from app.core.config import get_settings
from app.db import get_connection
from app.services.weights import HealthWeights, load_health_weights


def db_conn() -> Iterator[Connection]:
    """借出一条数据库连接；DB 不可达时返回 503 而非 500。"""
    try:
        with get_connection() as conn:
            yield conn
    except (OperationalError, PoolTimeout) as exc:  # pragma: no cover - 运行时才触发
        raise HTTPException(status_code=503, detail="database unavailable") from exc


def health_weights() -> HealthWeights:
    """按当前配置目录加载健康度权重（每次读取，便于权重调优即时生效）。"""
    return load_health_weights(get_settings().config_dir)


def resolve_repo(conn: Connection, repo_ref: str) -> dict:
    """把路径里的 `{id}` 解析为 dim_repo 一行。

    支持三种形式：数字 repo_id、"owner/name"、或唯一仓库名。
    找不到时抛 404（FastAPI HTTPException）。
    """
    if repo_ref.isdigit():
        row = conn.execute(
            "SELECT repo_id, gh_id, owner, name, default_branch, archived, tracked_at"
            " FROM dim_repo WHERE repo_id = %s",
            (int(repo_ref),),
        ).fetchone()
    elif "/" in repo_ref:
        owner, name = repo_ref.split("/", 1)
        row = conn.execute(
            "SELECT repo_id, gh_id, owner, name, default_branch, archived, tracked_at"
            " FROM dim_repo WHERE owner = %s AND name = %s",
            (owner, name),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT repo_id, gh_id, owner, name, default_branch, archived, tracked_at"
            " FROM dim_repo WHERE name = %s ORDER BY repo_id LIMIT 1",
            (repo_ref,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail=f"repo not found: {repo_ref}")
    return {
        "repo_id": row[0],
        "gh_id": row[1],
        "owner": row[2],
        "name": row[3],
        "default_branch": row[4],
        "archived": row[5],
        "tracked_at": row[6].isoformat() if row[6] else None,
    }