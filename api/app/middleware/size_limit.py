"""请求体积与 URL 长度检查：超限直接拒绝，避免打到大 body 才失败。"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.response import CODE_PAYLOAD_TOO_LARGE, CODE_URI_TOO_LONG, api_json


class SizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, max_body_bytes: int, max_url_length: int) -> None:
        super().__init__(app)
        self.max_body_bytes = max_body_bytes
        self.max_url_length = max_url_length

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = getattr(request.state, "request_id", "-")

        if len(str(request.url)) > self.max_url_length:
            return api_json(
                None,
                code=CODE_URI_TOO_LONG,
                message="request uri too long",
                request_id=request_id,
                status_code=414,
            )

        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                declared = 0
            if declared > self.max_body_bytes:
                return api_json(
                    None,
                    code=CODE_PAYLOAD_TOO_LARGE,
                    message="request body too large",
                    request_id=request_id,
                    status_code=413,
                )

        return await call_next(request)
