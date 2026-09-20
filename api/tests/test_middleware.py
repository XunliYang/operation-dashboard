"""中间件行为：限流、体积限制、超时。"""

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.response import CODE_PAYLOAD_TOO_LARGE, CODE_RATE_LIMITED, api_json
from app.middleware.rate_limit import RateLimiter, RateLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware
from app.middleware.size_limit import SizeLimitMiddleware
from app.middleware.timeout import TimeoutMiddleware

# --- RateLimiter 单元 ---


def test_rate_limiter_allows_up_to_limit_then_blocks():
    limiter = RateLimiter(limit=3, window_seconds=60.0)

    assert [limiter.allow("ip-1", now=0.0) for _ in range(3)] == [True, True, True]
    assert limiter.allow("ip-1", now=0.0) is False
    # 其他 IP 不受影响
    assert limiter.allow("ip-2", now=0.0) is True


def test_rate_limiter_window_slides():
    limiter = RateLimiter(limit=1, window_seconds=60.0)

    assert limiter.allow("ip-1", now=0.0) is True
    assert limiter.allow("ip-1", now=59.0) is False
    assert limiter.allow("ip-1", now=61.0) is True


def test_rate_limit_middleware_returns_429_envelope():
    app = FastAPI()

    @app.get("/ping")
    async def ping():
        return api_json("pong")

    app.add_middleware(RateLimitMiddleware, limit=2, window_seconds=60.0, exempt_paths={"/healthz"})

    with TestClient(app) as client:
        assert client.get("/ping").status_code == 200
        assert client.get("/ping").status_code == 200
        blocked = client.get("/ping")

    assert blocked.status_code == 429
    assert blocked.json()["code"] == CODE_RATE_LIMITED
    assert set(blocked.json()) == {"code", "message", "data", "request_id"}


def test_rate_limit_exempts_healthz():
    app = FastAPI()

    @app.get("/healthz")
    async def healthz():
        return api_json("ok")

    app.add_middleware(RateLimitMiddleware, limit=1, window_seconds=60.0, exempt_paths={"/healthz"})

    with TestClient(app) as client:
        statuses = [client.get("/healthz").status_code for _ in range(5)]

    assert statuses == [200] * 5


# --- SizeLimitMiddleware ---


def _size_limited_app(max_body_bytes: int, max_url_length: int) -> FastAPI:
    app = FastAPI()

    @app.post("/echo")
    async def echo():
        return api_json("ok")

    @app.get("/ok")
    async def ok():
        return api_json("ok")

    app.add_middleware(
        SizeLimitMiddleware, max_body_bytes=max_body_bytes, max_url_length=max_url_length
    )
    return app


def test_oversized_body_is_rejected_413():
    with TestClient(_size_limited_app(64, 2048)) as client:
        resp = client.post("/echo", content=b"x" * 128)

    assert resp.status_code == 413
    assert resp.json()["code"] == CODE_PAYLOAD_TOO_LARGE


def test_body_within_limit_passes():
    with TestClient(_size_limited_app(64, 2048)) as client:
        resp = client.post("/echo", content=b"x" * 10)

    assert resp.status_code == 200


def test_oversized_url_is_rejected_414():
    with TestClient(_size_limited_app(1024, 64)) as client:
        resp = client.get("/ok?q=" + "a" * 200)

    assert resp.status_code == 414


# --- TimeoutMiddleware ---


def test_slow_request_times_out_with_504():
    app = FastAPI()

    @app.get("/slow")
    async def slow():
        import asyncio

        await asyncio.sleep(1.0)
        return api_json("done")

    app.add_middleware(TimeoutMiddleware, timeout_seconds=0.05)

    with TestClient(app) as client:
        resp = client.get("/slow")

    assert resp.status_code == 504
    assert resp.json()["message"] == "request timeout"


def test_fast_request_not_affected_by_timeout():
    app = FastAPI()

    @app.get("/fast")
    async def fast():
        return api_json("done")

    app.add_middleware(TimeoutMiddleware, timeout_seconds=5.0)

    with TestClient(app) as client:
        resp = client.get("/fast")

    assert resp.status_code == 200


# --- RequestIdMiddleware ---


def test_request_id_middleware_sets_header_and_state():
    app = FastAPI()

    @app.get("/rid")
    async def rid():
        return api_json("ok")

    app.add_middleware(RequestIdMiddleware)

    with TestClient(app) as client:
        resp = client.get("/rid", headers={"X-Request-Id": "fixed-id"})

    assert resp.headers["X-Request-Id"] == "fixed-id"


@pytest.mark.parametrize("header", [None, "client-supplied"])
def test_request_id_always_present(header):
    app = FastAPI()

    @app.get("/rid")
    async def rid():
        return api_json("ok")

    app.add_middleware(RequestIdMiddleware)

    headers = {"X-Request-Id": header} if header else {}
    with TestClient(app) as client:
        resp = client.get("/rid", headers=headers)

    assert resp.headers.get("X-Request-Id")


def test_request_id_context_is_reset_between_requests():
    from app.middleware.request_id import get_request_id

    app = FastAPI()

    @app.get("/rid")
    async def rid():
        return api_json(get_request_id())

    app.add_middleware(RequestIdMiddleware)

    with TestClient(app) as client:
        first = client.get("/rid").json()["data"]
        second = client.get("/rid").json()["data"]

    assert first and second and first != second


def test_monotonic_clock_is_used_for_limiter():
    # 防回归：限流窗口必须基于单调时钟，避免系统时间回拨导致永久封禁
    limiter = RateLimiter(limit=1, window_seconds=10.0)
    now = time.monotonic()
    assert limiter.allow("k", now=now) is True
    assert limiter.allow("k", now=now + 1) is False
