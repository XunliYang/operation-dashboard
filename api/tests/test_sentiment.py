"""BFF 舆情聚合路由（LEOY-7 · Phase 3）。

验证统一包装、显式 id 映射、舆情不可用时降级而非 5xx。
不依赖真实 Postgres / 舆情服务：monkeypatch 映射加载与只读端点拉取。
"""

from __future__ import annotations

import app.routers.sentiment as sentiment_router
from app.services.sentiment import load_sentiment_mapping

REQUIRED_KEYS = {"code", "message", "data", "request_id"}

STATS = {
    "total": 10,
    "distribution": {"positive": 6, "neutral": 2, "negative": 2},
    "ratio": {"positive": 0.6, "neutral": 0.2, "negative": 0.2},
    "score": 0.4,
    "daily": [
        {"date": "2026-09-16", "total": 10, "positive": 6, "neutral": 2, "negative": 2, "score": 0.4},
    ],
    "platforms": [{"source": "weibo", "count": 7}],
    "spike_detected": False,
    "last_updated": "2026-09-16T12:00:00.000Z",
}


def _map(monkeypatch, mapping):
    monkeypatch.setattr(sentiment_router, "load_sentiment_mapping", lambda _config_dir: mapping)


def _fetch(monkeypatch, result):
    monkeypatch.setattr(
        sentiment_router,
        "fetch_sentiment_stats",
        lambda *args, **kwargs: result,
    )


def test_summary_returns_envelope_and_aggregated_summary(client, monkeypatch):
    _map(monkeypatch, {"owner/name": 1})
    _fetch(monkeypatch, STATS)

    resp = client.get("/dashboard/sentiment/summary", params={"repo": "owner/name"})

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == REQUIRED_KEYS
    assert body["code"] == 0
    assert body["data"]["degraded"] is False
    assert body["data"]["summary"]["total"] == 10
    assert body["data"]["summary"]["score"] == 0.4
    # 摘要不下发逐日序列
    assert "daily" not in body["data"]["summary"]


def test_timeseries_returns_daily_series(client, monkeypatch):
    _map(monkeypatch, {"owner/name": 1})
    _fetch(monkeypatch, STATS)

    resp = client.get("/dashboard/sentiment/timeseries", params={"repo": "owner/name"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["degraded"] is False
    assert body["data"]["series"][0]["date"] == "2026-09-16"


def test_unavailable_project_degrades_not_500(client, monkeypatch):
    # 篡改映射指向不存在项目：只读端点返回 None（连接失败 / 404）→ degraded，而非 500
    _map(monkeypatch, {"owner/name": 99999})
    _fetch(monkeypatch, None)

    resp = client.get("/dashboard/sentiment/summary", params={"repo": "owner/name"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["degraded"] is True
    assert body["data"]["summary"] is None


def test_unmapped_repo_degrades(client, monkeypatch):
    _map(monkeypatch, {})

    resp = client.get("/dashboard/sentiment/summary", params={"repo": "other/repo"})

    assert resp.status_code == 200
    assert resp.json()["data"]["degraded"] is True


def test_missing_repo_param_is_validation_error(client):
    resp = client.get("/dashboard/sentiment/summary")

    assert resp.status_code == 422


def test_mapping_file_loads_explicit_id():
    # 真实映射文件：显式 id、非名称模糊匹配
    mapping = load_sentiment_mapping("config")
    assert mapping.get("XunliYang/operation-dashboard") == 1
