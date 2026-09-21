"""健康度编排：指标抽取 + 评分 + 持久化到 agg_health_score_daily。"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.core.config import get_settings
from app.services.metrics import get_repo_indicators
from app.services.scoring import compute_health_score
from app.services.weights import HealthWeights


def compute_repo_health(
    conn: Connection,
    repo_id: int,
    config: HealthWeights,
    *,
    as_of: datetime | None = None,
    window_days: int | None = None,
    persist: bool = False,
) -> dict:
    """计算仓库当前健康度（综合分 + 五维明细，含原始指标）。

    返回结构：
      {"score": float, "dimensions": [{key,label,weight,score,indicators:[...]}]}
    """
    as_of = as_of or datetime.now(UTC)
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=UTC)
    window_days = window_days or get_settings().health_window_days

    indicators = get_repo_indicators(conn, repo_id, as_of=as_of, window_days=window_days)
    result = compute_health_score(indicators, config)

    if persist:
        persist_health(conn, repo_id, as_of.date(), result)
    return result


def persist_health(conn: Connection, repo_id: int, day: date, result: dict) -> None:
    """把综合分与各维度分写入 agg_health_score_daily（upsert）。"""
    rows = [("composite", result["score"], result)]
    for dim in result["dimensions"]:
        rows.append((dim["key"], dim["score"], dim))
    for dimension, score, raw in rows:
        conn.execute(
            "INSERT INTO agg_health_score_daily (repo_id, date, dimension, score, raw)"
            " VALUES (%s, %s, %s, %s, %s)"
            " ON CONFLICT (repo_id, date, dimension)"
            " DO UPDATE SET score = EXCLUDED.score, raw = EXCLUDED.raw",
            (repo_id, day, dimension, score, Jsonb(_walk(raw))),
        )


def _walk(obj):
    from decimal import Decimal

    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _walk(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_walk(v) for v in obj]
    return obj


def compute_health_series(
    conn: Connection,
    repo_id: int,
    config: HealthWeights,
    *,
    start: date,
    end: date,
    window_days: int,
) -> list[dict]:
    """按日粒度计算一段区间内每天的健康分时序（截至每日 23:59:59）。

    返回 [{date, score, dimensions:[{key, score}]}, ...]，日期升序。
    分数在读取时惰性计算并写回 agg_health_score_daily 作缓存。
    """
    series: list[dict] = []
    day = start
    while day <= end:
        as_of = datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=UTC)
        result = compute_repo_health(
            conn, repo_id, config, as_of=as_of, window_days=window_days, persist=True
        )
        series.append(
            {
                "date": day.isoformat(),
                "score": result["score"],
                "dimensions": [
                    {"key": d["key"], "score": d["score"]} for d in result["dimensions"]
                ],
            }
        )
        day += timedelta(days=1)
    return series