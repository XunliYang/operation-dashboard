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


# --- paged()：ETag/If-None-Match + 304 缓存命中（P1-2 回归防护） ---


def test_paged_sends_if_none_match_and_uses_cache_on_304():
    inm_seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        inm_seen.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"etag-list"':
            return httpx.Response(304)
        return httpx.Response(200, headers={"ETag": '"etag-list"'}, json=[{"id": 1}, {"id": 2}])

    client = _client(handler, sleeps=[])
    assert client.paged("/repos/x/y/pulls") == [{"id": 1}, {"id": 2}]
    # 第二次：带 If-None-Match → 304 → 返回缓存体（不再静默丢数据）
    assert client.paged("/repos/x/y/pulls") == [{"id": 1}, {"id": 2}]
    assert inm_seen == [None, '"etag-list"']


def test_paged_304_without_cache_falls_back_to_unconditional_refetch():
    inm_seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        inm_seen.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"stale-etag"':
            return httpx.Response(304)
        return httpx.Response(200, headers={"ETag": '"fresh-etag"'}, json=[{"id": 1}])

    client = _client(handler, sleeps=[])
    # 伪造「只写了 etag 却没有缓存体」的状态 → 304 未命中必须回退重拉
    client._etags["/repos/x/y/pulls"] = '"stale-etag"'
    assert client.paged("/repos/x/y/pulls") == [{"id": 1}]
    assert inm_seen == ['"stale-etag"', None]


def test_paged_respects_stop_after():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Link": '<https://api.github.com/repos/x/y/pulls?page=2>; rel="next"'},
            json=[{"n": 3}, {"n": 2}, {"n": 1}],
        )

    client = _client(handler, sleeps=[])
    seen_pages: list[int] = []

    def stop_after(items: list[dict]) -> tuple[list[dict], bool]:
        seen_pages.append(len(items))
        return items[:1], True  # 只保留第一条并立即停止

    out = client.paged("/repos/x/y/pulls", stop_after=stop_after)
    assert out == [{"n": 3}]
    assert seen_pages == [3]  # 只翻了一页即早停


def test_paged_follows_next_link_with_page_param():
    """翻页必须把 Link 里的 page=N 带进下一次请求（曾因空 params 覆盖 query 而重复拉第一页）。"""
    seen: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        page = req.url.params.get("page")
        seen.append(page)
        if page is None:
            return httpx.Response(
                200,
                headers={"Link": '<https://api.github.com/repos/x/y/pulls?page=2>; rel="next"'},
                json=[{"page": 1}],
            )
        return httpx.Response(200, json=[{"page": page}])

    client = _client(handler, sleeps=[])
    out = client.paged("/repos/x/y/pulls")
    assert out == [{"page": 1}, {"page": "2"}]
    assert seen == [None, "2"]  # 第二页请求带上了 page=2