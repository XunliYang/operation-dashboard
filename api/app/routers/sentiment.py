"""看板 C · 舆情聚合 BFF（LEOY-7 · Phase 3）。

端点（nginx 已剥掉 `/rest/v1` 前缀）：
  GET /dashboard/sentiment/summary?repo=owner/name&from&to
  GET /dashboard/sentiment/timeseries?repo=owner/name&from&to

流程：读 `config/sentiment_mapping.yaml` 的 `repo_project_map`（显式 id）→ 代理舆情
只读端点 `GET /api/projects/:id/sentiment/stats` → 统一 `{code,message,data,request_id}`。
前端不直连舆情服务地址；舆情不可用（连接失败 / 404 / 映射缺失）时返回
`data.degraded=true`，绝不把舆情故障升级成 BFF 的 5xx。
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.core.config import get_settings
from app.core.response import CODE_OK, api_json
from app.services.sentiment import fetch_sentiment_stats, load_sentiment_mapping

router = APIRouter(prefix="/dashboard/sentiment", tags=["sentiment"])

# 汇总里不下发逐日序列，保持卡片轻量；趋势走 /timeseries。
_SUMMARY_KEYS = ("total", "distribution", "ratio", "score", "platforms", "spike_detected", "last_updated")


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _degraded(request: Request, reason: str) -> dict:
    return api_json(
        {"degraded": True, "summary": None, "reason": reason},
        code=CODE_OK,
        message="ok",
        request_id=_rid(request),
    )


def _fetch(request: Request, repo: str, frm: str | None, to: str | None) -> dict | None:
    settings = get_settings()
    project_id = load_sentiment_mapping(settings.config_dir).get(repo)
    if project_id is None:
        return None
    return fetch_sentiment_stats(
        settings.sentiment_base_url,
        project_id,
        frm,
        to,
        settings.sentiment_timeout_seconds,
        auth_token=settings.sentiment_auth_token,
    )


@router.get("/summary", summary="舆情聚合摘要（total / distribution / score / spike）")
def sentiment_summary(
    request: Request,
    repo: str = Query(..., min_length=1),
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
):
    stats = _fetch(request, repo, frm, to)
    if stats is None:
        return _degraded(request, "sentiment unavailable")
    summary = {k: stats.get(k) for k in _SUMMARY_KEYS if k in stats}
    return api_json(
        {"degraded": False, "summary": summary},
        code=CODE_OK,
        message="ok",
        request_id=_rid(request),
    )


@router.get("/timeseries", summary="舆情情感逐日趋势")
def sentiment_timeseries(
    request: Request,
    repo: str = Query(..., min_length=1),
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
):
    stats = _fetch(request, repo, frm, to)
    if stats is None:
        return api_json(
            {"degraded": True, "series": None, "reason": "sentiment unavailable"},
            code=CODE_OK,
            message="ok",
            request_id=_rid(request),
        )
    return api_json(
        {"degraded": False, "series": stats.get("daily", [])},
        code=CODE_OK,
        message="ok",
        request_id=_rid(request),
    )