"""限流治理纯函数：指数退避 + 抖动、Retry-After 下限、token 池轮转、配额解析。"""

from collector.github.ratelimit import (
    TokenPool,
    jittered_backoff,
    parse_rate_limit,
    retry_delay,
)


def test_jittered_backoff_deterministic_without_jitter():
    assert jittered_backoff(0, base=1.0, cap=60.0, jitter=0) == 1.0
    assert jittered_backoff(1, base=1.0, cap=60.0, jitter=0) == 2.0
    assert jittered_backoff(2, base=1.0, cap=60.0, jitter=0) == 4.0


def test_jittered_backoff_bounds_with_jitter():
    for attempt in range(6):
        raw = min(1.0 * (2**attempt), 60.0)
        for _ in range(20):
            d = jittered_backoff(attempt, base=1.0, cap=60.0, jitter=0.3)
            assert raw * (1 - 0.3) <= d <= raw * (1 + 0.3)


def test_jittered_backoff_capped():
    assert jittered_backoff(100, base=1.0, cap=60.0, jitter=0) == 60.0


def test_retry_delay_respects_retry_after_floor():
    # jitter=0 → jittered_backoff(0)=1.0；Retry-After=5 → 取 5 作下限
    assert retry_delay(0, retry_after=5.0, base=1.0, jitter=0) == 5.0
    # Retry-After 小于退避值时，退避值生效
    assert retry_delay(0, retry_after=0.5, base=1.0, jitter=0) == 1.0


def test_token_pool_round_robin():
    pool = TokenPool(["a", "b", "c"])
    assert [pool.next() for _ in range(5)] == ["a", "b", "c", "a", "b"]


def test_token_pool_empty_returns_none():
    assert TokenPool([]).next() is None
    assert TokenPool(["   "]).next() is None
    assert TokenPool(["a", " "]).next() == "a"


def test_parse_rate_limit():
    state = parse_rate_limit(
        {"X-RateLimit-Remaining": "4999", "X-RateLimit-Limit": "5000", "X-RateLimit-Reset": "1789960303"}
    )
    assert state.remaining == 4999
    assert state.limit == 5000
    assert state.exhausted is False
    assert parse_rate_limit({"X-RateLimit-Remaining": "0"}).exhausted is True
    missing = parse_rate_limit({})
    assert missing.remaining is None and missing.exhausted is False