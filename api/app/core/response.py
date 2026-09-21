"""统一响应包装：`{code, message, data, request_id}`。

约定：
- `code == 0` 表示成功，非 0 为业务/系统错误码。
- HTTP 状态码与 `code` 解耦：HTTP 负责传输层语义，`code` 负责业务语义。
- `request_id` 从请求上下文（`request.state.request_id`）透传，便于日志串联。
"""

from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel

REQUEST_ID_HEADER = "X-Request-Id"

# 业务错误码
CODE_OK = 0
CODE_BAD_REQUEST = 40000
CODE_NOT_FOUND = 40400
CODE_PAYLOAD_TOO_LARGE = 41300
CODE_URI_TOO_LONG = 41400
CODE_RATE_LIMITED = 42900
CODE_TIMEOUT = 50400
CODE_INTERNAL_ERROR = 50000


class ApiResponse(BaseModel):
    """统一响应体的类型声明（用于 OpenAPI 文档）。"""

    code: int
    message: str
    data: Any = None
    request_id: str


def envelope(
    data: Any = None,
    *,
    code: int = CODE_OK,
    message: str = "ok",
    request_id: str = "-",
) -> dict[str, Any]:
    return {"code": code, "message": message, "data": data, "request_id": request_id}


def api_json(
    data: Any = None,
    *,
    code: int = CODE_OK,
    message: str = "ok",
    request_id: str = "-",
    status_code: int = 200,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=envelope(data, code=code, message=message, request_id=request_id),
        headers={REQUEST_ID_HEADER: request_id},
    )
