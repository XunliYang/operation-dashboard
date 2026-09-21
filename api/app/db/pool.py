"""数据库连接池：惰性初始化，供路由与服务层共享。"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg_pool import ConnectionPool

from app.core.config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    """返回进程级连接池（惰性创建）。"""
    global _pool
    if _pool is None:
        url = get_settings().database_url
        pool = ConnectionPool(url, min_size=1, max_size=10, open=False)
        pool.open()
        _pool = pool
    return _pool


@contextmanager
def get_connection() -> Iterator[Connection]:
    """从池中借出一条连接，使用后归还。"""
    pool = get_pool()
    with pool.connection() as conn:
        yield conn