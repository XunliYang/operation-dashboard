"""健康检查路由。"""

from fastapi import APIRouter, Request

from app.core.response import CODE_OK, api_json

router = APIRouter(tags=["health"])


@router.get("/healthz", summary="存活探针")
async def healthz(request: Request):
    """返回服务存活状态。响应体遵循统一包装 `{code,message,data,request_id}`。"""
    return api_json(
        {"status": "ok", "service": "api"},
        code=CODE_OK,
        message="ok",
        request_id=getattr(request.state, "request_id", "-"),
    )
