"""统一异常处理：任何异常都返回 `{code,message,data,request_id}` 包装。"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import bind_request_id
from app.core.response import (
    CODE_BAD_REQUEST,
    CODE_INTERNAL_ERROR,
    CODE_NOT_FOUND,
    api_json,
)


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exception(request: Request, exc: StarletteHTTPException):
        code = CODE_NOT_FOUND if exc.status_code == 404 else CODE_BAD_REQUEST
        if exc.status_code >= 500:
            code = CODE_INTERNAL_ERROR
        return api_json(
            None,
            code=code,
            message=str(exc.detail),
            request_id=_rid(request),
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        return api_json(
            exc.errors(),
            code=CODE_BAD_REQUEST,
            message="validation error",
            request_id=_rid(request),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        bind_request_id(_rid(request)).exception("unhandled error: {}", exc)
        return api_json(
            None,
            code=CODE_INTERNAL_ERROR,
            message="internal server error",
            request_id=_rid(request),
            status_code=500,
        )
