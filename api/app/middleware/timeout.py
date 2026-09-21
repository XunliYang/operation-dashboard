"""请求超时：超过阈值返回 504，防止慢请求占满 worker。"""

import asyncio

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import bind_request_id
from app.core.response import CODE_TIMEOUT, api_json


class TimeoutMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, timeout_seconds: float) -> None:
        super().__init__(app)
        self.timeout_seconds = timeout_seconds

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = getattr(request.state, "request_id", "-")
        try:
            return await asyncio.wait_for(call_next(request), timeout=self.timeout_seconds)
        except TimeoutError:
            bind_request_id(request_id).warning(
                "request timed out after {}s: {} {}", self.timeout_seconds, request.method, request.url.path
            )
            return api_json(
                None,
                code=CODE_TIMEOUT,
                message="request timeout",
                request_id=request_id,
                status_code=504,
            )
