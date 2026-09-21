"""数据库连接池：惰性初始化，供路由与服务层共享。"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg_pool import ConnectionPool

from app.core.config import get_settings

_pool: ConnectionPool | None = None

# 从池中借出连接的最大等待秒数。DB 不可达时 `connection()` 会在此超时后
# 抛 PoolTimeout（被 deps.db_conn 捕获并返回 503），而非无限阻塞。
_CONNECTION_TIMEOUT = 5


def get_pool() -> ConnectionPool:
    """返回进程级连接池（惰性创建）。"""
    global _pool
    if _pool is None:
        url = get_settings().database_url
        pool = ConnectionPool(
            url,
            min_size=1,
            max_size=10,
            open=False,
            kwargs={"connect_timeout": 5},
        )
        pool.open()
        _pool = pool
    return _pool


@contextmanager
def get_connection() -> Iterator[Connection]:
    """从池中借出一条连接，使用后归还。"""
    pool = get_pool()
    with pool.connection(timeout=_CONNECTION_TIMEOUT) as conn:
        yield conn