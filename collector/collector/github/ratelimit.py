"""限流治理：token 池轮转、指数退避 + 抖动、配额状态。

对应架构 §5.1：
- 监控 `X-RateLimit-Remaining` / `X-RateLimit-Reset`，低于阈值降速并记 collect_run。
- 二次限流（403 + `Retry-After`）指数退避 + 抖动，禁止并发猛打。
- 多 PAT 的 token 池轮转。
"""

from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass


@dataclass
class RateLimitState:
    """一次响应后解析出的配额状态。"""

    limit: int | None
    remaining: int | None
    reset_epoch: float | None

    @property
    def exhausted(self) -> bool:
        return self.remaining is not None and self.remaining <= 0


class TokenPool:
    """多个 GitHub token 的轮转池。

    - 空池表示未认证（GitHub 会按 IP 限流 60/h）。
    - `next()` 循环轮转；单 token 退化为每次都返回同一个。
    """

    def __init__(self, tokens: list[str]) -> None:
        self._tokens = [t.strip() for t in tokens if t and t.strip()]
        self._lock = threading.Lock()
        self._idx = 0

    def __len__(self) -> int:
        return len(self._tokens)

    def next(self) -> str | None:
        if not self._tokens:
            return None
        with self._lock:
            token = self._tokens[self._idx % len(self._tokens)]
            self._idx += 1
            return token


def jittered_backoff(
    attempt: int,
    *,
    base: float = 1.0,
    cap: float = 60.0,
    jitter: float = 0.3,
) -> float:
    """指数退避 + 抖动：delay = min(base · 2^attempt, cap) · U(1-jitter, 1+jitter)。

    attempt 从 0 开始。jitter=0 时退化为确定性指数退避（便于测试断言）。
    """
    attempt = max(0, int(attempt))
    raw = min(base * (2.0**attempt), float(cap))
    if jitter <= 0:
        return raw
    return raw * random.uniform(1.0 - jitter, 1.0 + jitter)


def retry_delay(
    attempt: int,
    *,
    retry_after: float | None = None,
    base: float = 1.0,
    cap: float = 60.0,
    jitter: float = 0.3,
) -> float:
    """一次重试前应等待的秒数：指数退避 + 抖动；若服务端给了 Retry-After 则取其下限。"""
    delay = jittered_backoff(attempt, base=base, cap=cap, jitter=jitter)
    if retry_after is not None and retry_after > delay:
        return retry_after
    return delay


def parse_rate_limit(headers) -> RateLimitState:
    """从响应头解析 X-RateLimit-*。GitHub 的 Reset 是 UTC 秒级 epoch。"""

    def _int(name: str) -> int | None:
        raw = headers.get(name)
        if raw is None:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    remaining = _int("X-RateLimit-Remaining")
    reset = _int("X-RateLimit-Reset")
    return RateLimitState(limit=_int("X-RateLimit-Limit"), remaining=remaining, reset_epoch=reset)


def seconds_until_reset(reset_epoch: float | None) -> float | None:
    if reset_epoch is None:
        return None
    return max(0.0, reset_epoch - time.time())