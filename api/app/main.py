"""FastAPI 应用装配。

中间件顺序（外层 → 内层，Starlette 反向包裹）：
    CORS → RateLimit → SizeLimit → RequestId → Timeout → 路由

注意 `add_middleware` 是后添加者在外层，因此下面按内层到外层注册。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import setup_logging
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.middleware.size_limit import SizeLimitMiddleware
from app.middleware.timeout import TimeoutMiddleware
from app.routers.admin import router as admin_router
from app.routers.repos import router as repos_router

# 不限流的路径
RATE_LIMIT_EXEMPT = {"/healthz"}


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.is_dev else None,
        redoc_url=None,
    )

    # 内层先注册
    app.add_middleware(TimeoutMiddleware, timeout_seconds=settings.request_timeout_seconds)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        SizeLimitMiddleware,
        max_body_bytes=settings.max_body_bytes,
        max_url_length=settings.max_url_length,
    )
    app.add_middleware(
        RateLimitMiddleware,
        limit=settings.rate_limit_per_minute,
        window_seconds=60.0,
        exempt_paths=RATE_LIMIT_EXEMPT,
    )
    if settings.is_dev:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Request-Id"],
        )

    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(repos_router)
    app.include_router(admin_router)
    return app


app = create_app()
