"""按客户端 IP 的滑动窗口限流（内存实现，Phase 0 单实例够用）。

后续多实例部署时替换为 Redis 实现：`RateLimiter` 保持同一接口即可。
"""

import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.response import CODE_RATE_LIMITED, api_json


class RateLimiter:
    """固定窗口计数器：每个 key 在 window_seconds 内最多 limit 次。"""

    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        bucket = self._hits[key]
        cutoff = now - self.window_seconds
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

        if len(bucket) >= self.limit:
            return False

        bucket.append(now)
        return True

    def retry_after(self, key: str, now: float | None = None) -> int:
        now = time.monotonic() if now is None else now
        bucket = self._hits[key]
        if not bucket:
            return 0
        return max(1, int(self.window_seconds - (now - bucket[0])) + 1)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, limit: int, window_seconds: float = 60.0, exempt_paths: set[str] | None = None) -> None:
        super().__init__(app)
        self.limiter = RateLimiter(limit=limit, window_seconds=window_seconds)
        self.exempt_paths = exempt_paths or set()

    def _client_key(self, request: Request) -> str:
        # nginx 透传的真实来源；直连时回退到 socket 地址
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in self.exempt_paths:
            return await call_next(request)

        key = self._client_key(request)
        if not self.limiter.allow(key):
            request_id = getattr(request.state, "request_id", "-")
            return api_json(
                None,
                code=CODE_RATE_LIMITED,
                message="too many requests",
                request_id=request_id,
                status_code=429,
            )

        return await call_next(request)
