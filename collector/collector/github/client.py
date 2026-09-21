"""GitHub 客户端：REST（since + ETag/If-None-Match，304 不计配额）+ GraphQL 批量。

- ETag 缓存：命中 304 直接返回缓存体，不重复解析、不计配额。
- 配额治理：解析 X-RateLimit-Remaining/Reset，低于阈值降速；二次限流
  （403 + Retry-After）指数退避 + 抖动。
- token 池轮转（多 PAT）。
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from typing import Any

import httpx

from collector.github.ratelimit import (
    RateLimitState,
    TokenPool,
    parse_rate_limit,
    retry_delay,
)


class GitHubApiError(Exception):
    """GitHub API 非 2xx 响应。"""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"GitHub API {status}: {message}")
        self.status = status


class RateLimitExceeded(GitHubApiError):
    """配额耗尽（remaining <= 0），不应继续请求。"""


_LINK_RE = re.compile(r'<([^>]+)>\s*;\s*rel="([^"]+)"')


def parse_next_link(link_header: str | None) -> str | None:
    """从 Link 响应头解析 rel="next" 的绝对 URL。"""
    if not link_header:
        return None
    for part in link_header.split(","):
        m = _LINK_RE.search(part)
        if m and m.group(2) == "next":
            return m.group(1)
    return None


class GitHubClient:
    def __init__(
        self,
        *,
        token_pool: TokenPool,
        base_url: str = "https://api.github.com",
        transport: httpx.BaseTransport | None = None,
        rate_limit_threshold: int = 100,
        throttle_delay_seconds: float = 0.5,
        max_retries: int = 5,
        timeout: float = 30.0,
        sleep_fn: Callable[[float], None] | None = None,
        backoff_base: float = 1.0,
        backoff_cap: float = 60.0,
        backoff_jitter: float = 0.3,
    ) -> None:
        self._tokens = token_pool
        self._client = httpx.Client(
            base_url=base_url, transport=transport, timeout=timeout, follow_redirects=True
        )
        self.rate_limit_threshold = rate_limit_threshold
        self.throttle_delay_seconds = throttle_delay_seconds
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_cap = backoff_cap
        self.backoff_jitter = backoff_jitter
        self._etags: dict[str, str] = {}
        self._cache: dict[str, Any] = {}
        self._page_cache: dict[str, tuple[Any, str | None]] = {}
        self._sleep = sleep_fn or time.sleep

        # 最近一次响应的配额状态（用于写 collect_run）
        self.rate_limit: RateLimitState | None = None
        self.throttled: bool = False

    # ---- 基础请求 ----

    def _headers(self, extra: dict[str, str] | None) -> dict[str, str]:
        headers = {"Accept": "application/vnd.github+json"}
        token = self._tokens.next()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if extra:
            headers.update(extra)
        return headers

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        kwargs["headers"] = self._headers(kwargs.pop("headers", None))
        return self._client.request(method, url, **kwargs)

    # ---- 配额治理 ----

    def _update_rate_limit(self, resp: httpx.Response) -> None:
        state = parse_rate_limit(resp.headers)
        if state.remaining is not None:
            self.rate_limit = state

    def _throttle_if_low(self) -> None:
        """低于阈值时降速：让出少量时间，避免落到二次限流。"""
        if self.rate_limit is None or self.rate_limit.remaining is None:
            return
        if self.rate_limit.remaining <= 0:
            raise RateLimitExceeded(403, "X-RateLimit-Remaining exhausted")
        if self.rate_limit.remaining < self.rate_limit_threshold:
            self.throttled = True
            self._sleep(self.throttle_delay_seconds)

    def _request_robust(self, method: str, url: str, **kwargs) -> httpx.Response:
        """带二次限流退避与配额降速的请求（自动重试 429/5xx/403+Retry-After）。"""
        last: httpx.Response | None = None
        for attempt in range(self.max_retries + 1):
            resp = self.request(method, url, **kwargs)
            last = resp
            self._update_rate_limit(resp)
            self._throttle_if_low()

            retry = False
            delay: float | None = None
            if resp.status_code == 403 and resp.headers.get("Retry-After") is not None:
                # 二次限流：指数退避 + 抖动，尊重服务端 Retry-After 下限
                try:
                    retry_after = float(resp.headers["Retry-After"])
                except ValueError:
                    retry_after = None
                delay = retry_delay(
                    attempt,
                    retry_after=retry_after,
                    base=self.backoff_base,
                    cap=self.backoff_cap,
                    jitter=self.backoff_jitter,
                )
                retry = True
            elif resp.status_code in (429, 500, 502, 503):
                delay = retry_delay(
                    attempt,
                    base=self.backoff_base,
                    cap=self.backoff_cap,
                    jitter=self.backoff_jitter,
                )
                retry = True

            if retry and attempt < self.max_retries and delay is not None:
                self._sleep(delay)
                continue
            return resp
        return last  # pragma: no cover - 循环必然在 max_retries 内返回

    # ---- REST ----

    def get_json(self, url: str, params: dict | None = None) -> Any:
        headers: dict[str, str] = {}
        etag = self._etags.get(url)
        if etag:
            headers["If-None-Match"] = etag

        resp = self._request_robust("GET", url, params=params, headers=headers)
        if resp.status_code == 304:
            cached = self._cache.get(url)
            if cached is None:
                raise GitHubApiError(304, "Not Modified but no cached response")
            return cached
        if resp.status_code >= 400:
            raise GitHubApiError(resp.status_code, resp.text[:200])

        body = resp.json()
        new_etag = resp.headers.get("ETag")
        if new_etag:
            self._etags[url] = new_etag
            self._cache[url] = body
        return body

    def _page(self, url: str, params: dict | None) -> tuple[Any, str | None]:
        """单页 GET：复用 ETag/If-None-Match，304 命中时返回缓存体与缓存 Link。

        缓存未命中时回退为一次无条件重拉，绝不静默把 304 当空列表丢弃数据。
        返回 `(body, link_header)`。
        """
        headers: dict[str, str] = {}
        etag = self._etags.get(url)
        if etag:
            headers["If-None-Match"] = etag
        resp = self._request_robust("GET", url, params=params, headers=headers)
        self._update_rate_limit(resp)
        self._throttle_if_low()
        if resp.status_code == 304:
            cached = self._page_cache.get(url)
            if cached is not None:
                return cached
            # 缓存未命中（如 ETag 与缓存不同源）：回退为一次无条件重拉
            resp = self._request_robust("GET", url, params=params)
            self._update_rate_limit(resp)
            self._throttle_if_low()
        if resp.status_code >= 400:
            raise GitHubApiError(resp.status_code, resp.text[:200])
        body = resp.json()
        link = resp.headers.get("Link")
        new_etag = resp.headers.get("ETag")
        if new_etag:
            self._etags[url] = new_etag
            self._page_cache[url] = (body, link)
        return body, link

    def paged(
        self,
        url: str,
        params: dict | None = None,
        *,
        max_pages: int = 40,
        items_key: str | None = None,
        stop_after: Callable[[list[dict]], tuple[list[dict], bool]] | None = None,
    ) -> list[dict]:
        """翻页拉取（Link 头驱动）；返回合并后的列表。支持 since 增量与 ETag/304。

        `items_key` 用于响应体是对象（如 actions/runs 返回
        `{total_count, workflow_runs}`）时，从对象中取数组字段。

        `stop_after(page_items) -> (kept, stop)` 支持按游标早停：对按
        `sort=updated&direction=desc` 排序的列表，一旦页面时间戳早于上次游标
        即可 `stop`，并只保留游标之后的较新条目，避免整表重拉。
        """
        items: list[dict] = []
        params = dict(params or {})
        current = url
        for _ in range(max_pages):
            body, link = self._page(current, params)
            if isinstance(body, dict) and items_key:
                page_items: list[dict] = body.get(items_key, []) or []
            elif isinstance(body, list):
                page_items = body
            else:
                page_items = []
            if stop_after is not None:
                kept, stop = stop_after(page_items)
                items.extend(kept)
                if stop:
                    break
            else:
                items.extend(page_items)
            nxt = parse_next_link(link)
            if not nxt:
                break
            current = nxt
            params = None  # 后续页面参数已编码在 Link URL 中；传 None 避免空 dict 覆盖其 query
        return items

    # ---- GraphQL ----

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        resp = self._request_robust(
            "POST", "/graphql", json={"query": query, "variables": variables or {}}
        )
        if resp.status_code >= 400:
            raise GitHubApiError(resp.status_code, resp.text[:200])
        body = resp.json()
        if "errors" in body:
            raise GitHubApiError(resp.status_code, str(body["errors"])[:200])
        return body.get("data", {})