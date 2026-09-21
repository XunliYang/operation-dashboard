"""GitHubClient：ETag 304 路径、二次限流退避、指数退避（httpx.MockTransport 模拟）。"""

import httpx
import pytest

from collector.github.client import GitHubApiError, GitHubClient
from collector.github.ratelimit import TokenPool


def _client(handler, *, sleeps: list[float], **kw) -> GitHubClient:
    return GitHubClient(
        token_pool=TokenPool(["tok"]),
        transport=httpx.MockTransport(handler),
        sleep_fn=sleeps.append,
        **kw,
    )


def test_get_json_returns_cache_on_304():
    calls: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"etag-1"':
            return httpx.Response(304)
        return httpx.Response(200, headers={"ETag": '"etag-1"'}, json={"ok": True})

    client = _client(handler, sleeps=[])
    assert client.get_json("/repos/x/y") == {"ok": True}
    assert client.get_json("/repos/x/y") == {"ok": True}  # 304 → 返回缓存体
    assert calls == [None, '"etag-1"']  # 第二次请求带了 If-None-Match


def test_304_without_cache_falls_through_to_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(304)

    client = _client(handler, sleeps=[])
    with pytest.raises(GitHubApiError):
        client.get_json("/repos/x/y")


def test_secondary_rate_limit_retries_with_backoff_floor():
    sleeps: list[float] = []
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(403, headers={"Retry-After": "2"})
        return httpx.Response(200, json={"ok": True})

    client = _client(handler, sleeps=sleeps, backoff_jitter=0, backoff_base=1.0)
    assert client.get_json("/repos/x/y") == {"ok": True}
    assert calls["n"] == 2
    # retry_after=2 > jittered_backoff(0)=1.0 → 以 Retry-After 为下限
    assert sleeps == [2.0]


def test_429_exponential_backoff_then_error():
    sleeps: list[float] = []

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    client = _client(
        handler, sleeps=sleeps, backoff_jitter=0, backoff_base=2.0, backoff_cap=100, max_retries=3
    )
    with pytest.raises(GitHubApiError):
        client.get_json("/repos/x/y")
    # attempts 0/1/2 各退避一次，3 次退避后不再重试（max_retries=3）
    assert sleeps == [2.0, 4.0, 8.0]


def test_authorization_header_round_robin():
    seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        auth = req.headers.get("Authorization")
        seen.append(auth)
        return httpx.Response(200, json={"ok": True})

    client = GitHubClient(
        token_pool=TokenPool(["tok-a", "tok-b"]),
        transport=httpx.MockTransport(handler),
        sleep_fn=lambda s: None,
    )
    client.get_json("/a")
    client.get_json("/b")
    assert seen == ["Bearer tok-a", "Bearer tok-b"]