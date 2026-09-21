"""Redis 分布式锁接口占位。

Phase 0 只定义契约：job 执行前 `acquire`，执行后 `release`。
未配置 Redis 时由 `NullLock` 降级为单实例运行（不跨实例互斥）。
"""

from __future__ import annotations

import uuid
from typing import Protocol

from loguru import logger


class Lock(Protocol):
    def acquire(self, key: str, ttl_seconds: int) -> bool: ...

    def release(self, key: str) -> None: ...


class NullLock:
    """无 Redis 时的降级实现：永远获取成功，不做跨实例互斥。"""

    def acquire(self, key: str, ttl_seconds: int) -> bool:
        logger.debug("NullLock acquired {} (ttl={}s)", key, ttl_seconds)
        return True

    def release(self, key: str) -> None:
        logger.debug("NullLock released {}", key)


class RedisLock:
    """基于 `SET key token NX EX ttl` 的锁。

    释放时用 Lua 脚本校验 token，避免删掉别的实例持有的锁。
    """

    _RELEASE_SCRIPT = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    else
        return 0
    end
    """

    def __init__(self, redis_url: str, key_prefix: str = "od:collector:lock:") -> None:
        import redis  # 延迟导入，避免无 Redis 环境下 import 即失败

        self._client = redis.Redis.from_url(redis_url, decode_responses=True)
        self._prefix = key_prefix
        self._tokens: dict[str, str] = {}

    def _full_key(self, key: str) -> str:
        return f"{self._prefix}{key}"

    def acquire(self, key: str, ttl_seconds: int) -> bool:
        token = uuid.uuid4().hex
        # nx=True + ex=ttl 保证原子性
        ok = bool(self._client.set(self._full_key(key), token, nx=True, ex=ttl_seconds))
        if ok:
            self._tokens[key] = token
            logger.info("lock acquired: {}", key)
        else:
            logger.warning("lock busy, skip run: {}", key)
        return ok

    def release(self, key: str) -> None:
        token = self._tokens.pop(key, None)
        if token is None:
            return
        self._client.eval(self._RELEASE_SCRIPT, 1, self._full_key(key), token)
        logger.info("lock released: {}", key)


def build_lock(redis_url: str | None, key_prefix: str) -> Lock:
    """按配置构造锁实现；Redis 不可用时降级为 NullLock。"""
    if not redis_url:
        return NullLock()
    try:
        lock = RedisLock(redis_url, key_prefix)
        lock._client.ping()
        return lock
    except Exception as exc:  # noqa: BLE001 — 任何连接问题都降级
        logger.warning("Redis 不可用（{}），降级为 NullLock（无跨实例互斥）", exc)
        return NullLock()
