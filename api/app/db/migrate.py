"""迁移 runner：按序号应用 `migrations/*.sql`，已应用的记录在 `_schema_migrations`。

- 幂等：每个 SQL 文件在独立事务中执行，成功后写入版本记录。
- 多语句文件走 psycopg 简单查询协议（`prepare=False`）。
"""

from __future__ import annotations

import os
from pathlib import Path

from loguru import logger

from app.db.pool import get_pool

MIGRATIONS_DIR = Path(
    os.environ.get(
        "OD_MIGRATIONS_DIR",
        Path(__file__).resolve().parents[2] / "migrations",
    )
)


def migrate() -> list[str]:
    """应用尚未执行的迁移，返回本次应用的文件名列表。

    首次调用会创建 `_schema_migrations` 记录表。任何一步失败会抛出异常，
    由调用方决定是否重试（各文件独立事务，已成功的不会重复执行）。
    """
    pool = get_pool()
    applied_names: list[str] = []
    with pool.connection() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _schema_migrations ("
            " name TEXT PRIMARY KEY,"
            " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
            prepare=False,
        )
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            name = path.name
            row = conn.execute(
                "SELECT 1 FROM _schema_migrations WHERE name = %s", (name,)
            ).fetchone()
            if row is not None:
                continue
            sql = path.read_text(encoding="utf-8")
            with conn.transaction():
                conn.execute(sql, prepare=False)
                conn.execute(
                    "INSERT INTO _schema_migrations (name) VALUES (%s)", (name,)
                )
            applied_names.append(name)
            logger.info("migration applied: {}", name)
    return applied_names


if __name__ == "__main__":  # pragma: no cover - CLI 入口
    import sys
    import time

    from app.core.logging import setup_logging

    setup_logging()
    attempts = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    for i in range(attempts):
        try:
            names = migrate()
            logger.info("migrations up to date: applied={}", names)
            break
        except Exception as exc:  # noqa: BLE001 — DB 未就绪时重试
            if i == attempts - 1:
                logger.error("migrations failed after {} attempts: {}", attempts, exc)
                sys.exit(1)
            logger.warning("migration attempt {}/{} failed ({}), retrying", i + 1, attempts, exc)
            time.sleep(3)