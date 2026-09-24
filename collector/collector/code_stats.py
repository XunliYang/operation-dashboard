"""代码量采集：`GET /repos/{owner}/{name}/stats/contributors` → 写周桶。

关键实测行为：该端点首访会返回 `{}`（服务端 202 预热），稍后重试才返回数组。
因此「返回 `{}` 或非 list」必须当作**未就绪**处理：本轮跳过该仓库、保留旧数据，
**绝不能**把 `{}` 解析成 0 写库。响应里 `author` 为 `null` 的条目也要跳过并记日志。

写入目标：`fact_contributor_code_weekly`（周桶），`ON CONFLICT DO UPDATE` 可覆盖
（周桶会随 GitHub 重算而变化），见 collector/db.py 的 `upsert_code_weekly`。
"""

from __future__ import annotations

from datetime import UTC, datetime

from loguru import logger

import collector.db as db
from collector.github.client import GitHubApiError


def _fetch_contributor_stats(client, owner: str, name: str) -> list[dict] | None:
    """拉取 /stats/contributors；未就绪（202 预热 / `{}` / 非 list / 404）返回 None。"""
    url = f"/repos/{owner}/{name}/stats/contributors"
    try:
        data = client.get_json(url)
    except GitHubApiError as exc:
        if exc.status == 404:
            # 仓库不存在 / 无统计数据：正常路径，返回 None（跳过）
            return None
        raise
    except ValueError:
        # 202 预热可能返回空 body（Content-Length 0），httpx 的 .json() 抛
        # JSONDecodeError（ValueError 子类）——视为未就绪。
        return None
    if not isinstance(data, list):
        # 首访返回 `{}`（服务端 202 预热）；重试后才是数组。
        return None
    return data


def _last_active_week(weeks: list[dict]) -> datetime | None:
    """该作者存在提交（`c > 0`）的最大周时间戳；无任何活跃周时返回 None。

    `seen_at` 的唯一合法来源是真实活动时间——`/stats/contributors` 返回的 weeks
    里那些确实有提交的周。全部周 `c == 0` 表示「只出现过、从未有可计入的提交」，
    不能当作活动证据，返回 None 由调用方决定不推进 `last_seen_at`。
    """
    active = [
        datetime.fromtimestamp(int(w["w"]), tz=UTC)
        for w in weeks
        if w.get("w") is not None and int(w.get("c") or 0) > 0
    ]
    return max(active) if active else None


def collect_code_stats(client, conn, *, repo_id: int, owner: str, name: str) -> int:
    """把每个作者的 weekly a/d/c 桶写入 `fact_contributor_code_weekly`。

    返回写入的周桶数。未就绪时返回 0 且不写任何行（旧数据保留），不抛异常。

    活动证据约束（LEOY-70）：本 job 只读展示代码量，**不构成活动证据**，因此
    upsert 贡献者时 `seen_at` 只能来自该作者「存在提交（c>0）的最大周」，
    **绝不能用 `now()` 兜底**——`/stats/contributors` 返回历史全量作者（含早已
    停更的人），用 `now()` 会把休眠贡献者反复刷成「今天活跃」，污染
    `dim_contributor.last_seen_at`。作者没有任何活跃周（全部 `c == 0`）时跳过
    upsert（`author_id` 落 NULL，该列本就允许为空），不得推进 `last_seen_at`。
    """
    payload = _fetch_contributor_stats(client, owner, name)
    if payload is None:
        return 0

    count = 0
    for item in payload:
        author = item.get("author")
        if author is None:
            logger.warning("stats/contributors author is null for {}/{} (skipped)", owner, name)
            continue
        login = author.get("login")
        if not login:
            continue
        gh_id = author.get("id")
        seen_at = _last_active_week(item.get("weeks") or [])
        if seen_at is None:
            # 全部周 c==0：没有任何活跃周。不得推进 last_seen_at，也不得用 now()
            # 兜底创建/刷新贡献者；author_id 落 NULL（该列允许为空）。
            author_id = None
        else:
            author_id = db.upsert_contributor(
                conn, gh_login=login, gh_id=gh_id, display_name=login, seen_at=seen_at
            )
        for w in item.get("weeks") or []:
            ts = w.get("w")
            if ts is None:
                continue
            week_start = datetime.fromtimestamp(int(ts), tz=UTC).date()
            db.upsert_code_weekly(
                conn,
                repo_id=repo_id,
                author_id=author_id,
                gh_login=login,
                week_start=week_start,
                commits=int(w.get("c") or 0),
                additions=int(w.get("a") or 0),
                deletions=int(w.get("d") or 0),
            )
            count += 1
    return count