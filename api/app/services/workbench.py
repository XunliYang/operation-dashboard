"""工作台领域逻辑（LEOY-12 · Phase 1.7）。

纯函数层，不触 DB：路由器把 SQL 结果转成这里的入参后调用；单元测试直接以
固定 fixture 驱动。阈值集中在 `config/workbench.yaml`，经 `WorkbenchConfig`
传入，因此「改阈值配置 → 结果随之变化」可在纯函数层直接断言。

口径说明（每个指标对应的表与 SQL 片段见 `app/routers/workbench.py`）：

  stalled_repos
      启用（archived=false）仓库中，最近一次提交距今超过 `window_days` 天、
      或从未有提交的仓库数。依赖 `fact_commit` + `dim_repo`。

  health_drops
      近 `window_days` 天内 `agg_health_score_daily` 中 `composite` 维度
      （综合分）按仓库取「窗口内最早日分」与「最晚日分」，跌幅 = 最早 − 最晚；
      只保留跌幅 > 0 的仓库，按跌幅降序取前 `health_drop_top_n` 个。

  review_backlog
      打开且尚未收到首评（first_review_at IS NULL）、创建距今超过
      `review_backlog_days` 天的 PR 数。依赖 `fact_pull_request`。

  unlinked_prs
      打开且标题中不含 issue 号引用（`#[0-9]+`）的 PR 数。注意：本 schema 未采集
      PR body / linked-issue，此为基于标题的近似口径（见下 `_UNLINKED_PR_RE`）。

  slow_issue_response
      按仓库取 issue「关闭时长」（closed_at - created_at）的中位数，超过
      `slow_response_hours` 小时的仓库数。注意：`fact_issue` 尚无首响时间戳
      （issue 首条评论），这里以关闭时长为「首响」的近似口径。

  unclassified_people
      `bridge_contributor_org` 中 `source='inferred' AND confidence=0`（当前有效
      valid_to IS NULL）的去重人数；Phase 2 尚未写入分类数据（桥表为空）时返回
      `null`，前端卡片显示「待 Phase 2」。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import yaml

# 标题中识别 issue 号引用的正则（近似口径：无 body 数据，只能用标题）。
_UNLINKED_PR_RE = re.compile(r"#\d+")

DEFAULT_CONFIG = {
    "window_days": 7,
    "review_backlog_days": 3,
    "slow_response_hours": 48,
    "health_drop_top_n": 3,
    "health_drop_dimension": "composite",
    "list_limit": 10,
}


@dataclass(frozen=True)
class WorkbenchConfig:
    window_days: int = 7
    review_backlog_days: int = 3
    slow_response_hours: float = 48.0
    health_drop_top_n: int = 3
    health_drop_dimension: str = "composite"
    list_limit: int = 10


def _config_candidates(config_dir: str):
    """按顺序尝试：调用方指定目录，再到仓库根 `config/`（同 weights 的约定）。"""
    yield Path(config_dir) / "workbench.yaml"
    repo_root = Path(__file__).resolve().parents[3]  # services -> app -> api -> 仓库根
    yield repo_root / "config" / "workbench.yaml"


def load_workbench_config(config_dir: str) -> WorkbenchConfig:
    """加载 config/workbench.yaml；文件缺失时回退到内置默认（与 health_weights 同法）。"""
    for path in _config_candidates(config_dir):
        if path.is_file():
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            return WorkbenchConfig(
                window_days=int(raw.get("window_days", DEFAULT_CONFIG["window_days"])),
                review_backlog_days=int(
                    raw.get("review_backlog_days", DEFAULT_CONFIG["review_backlog_days"])
                ),
                slow_response_hours=float(
                    raw.get("slow_response_hours", DEFAULT_CONFIG["slow_response_hours"])
                ),
                health_drop_top_n=int(
                    raw.get("health_drop_top_n", DEFAULT_CONFIG["health_drop_top_n"])
                ),
                health_drop_dimension=str(
                    raw.get("health_drop_dimension", DEFAULT_CONFIG["health_drop_dimension"])
                ),
                list_limit=int(raw.get("list_limit", DEFAULT_CONFIG["list_limit"])),
            )
    return WorkbenchConfig()


# ---------------------------------------------------------------------------
# 路由器传入的行类型（dataclass 便于测试构造 fixed fixture）
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RepoRow:
    repo_id: int
    owner: str
    name: str
    archived: bool


@dataclass(frozen=True)
class HealthScoreRow:
    repo_id: int
    day: date
    score: float


@dataclass(frozen=True)
class OpenPrRow:
    repo_id: int
    owner: str
    name: str
    pr_number: int
    title: str | None
    created_at: datetime
    first_review_at: datetime | None


@dataclass(frozen=True)
class IssueResponseRow:
    repo_id: int
    owner: str
    name: str
    median_hours: float


@dataclass(frozen=True)
class MergeRow:
    repo_id: int
    owner: str
    name: str
    pr_number: int
    title: str | None
    merged_at: datetime


def _full_name(owner: str, name: str) -> str:
    return f"{owner}/{name}"


def _to(repo_id: int) -> str:
    """ListCard 跳转目标：仓库详情页。"""
    return f"/repos/{repo_id}"


def _days_since(moment: datetime, as_of: datetime) -> float:
    return (as_of - moment).total_seconds() / 86400.0


# ---------------------------------------------------------------------------
# 六项指标计算（纯函数，阈值全参数化）
# ---------------------------------------------------------------------------


def compute_stalled_repos(
    repos: list[RepoRow],
    last_commit_by_repo: dict[int, datetime],
    *,
    window_days: int,
    as_of: datetime,
) -> list[dict]:
    """启用仓库中最近提交距今超过 window_days 天（或无提交）的明细。"""
    out: list[dict] = []
    for repo in repos:
        if repo.archived:
            continue
        last = last_commit_by_repo.get(repo.repo_id)
        if last is None:
            days = None
            stalled = True
        else:
            days = round(_days_since(last, as_of))
            stalled = days > window_days
        if stalled:
            out.append(
                {
                    "repo_id": str(repo.repo_id),
                    "owner": repo.owner,
                    "name": repo.name,
                    "full_name": _full_name(repo.owner, repo.name),
                    "days_since_commit": days,
                    "to": _to(repo.repo_id),
                }
            )
    return out


def compute_health_drops(
    score_rows: list[HealthScoreRow],
    *,
    top_n: int,
) -> list[dict]:
    """按仓库取窗口内最早/最晚综合分，跌幅 = 最早 − 最晚，取跌幅 > 0 的前 top_n。"""
    by_repo: dict[int, list[HealthScoreRow]] = {}
    for row in score_rows:
        by_repo.setdefault(row.repo_id, []).append(row)

    drops: list[dict] = []
    for repo_id, rows in by_repo.items():
        first = min(rows, key=lambda r: r.day)
        last = max(rows, key=lambda r: r.day)
        drop = round(first.score - last.score, 2)
        if drop <= 0:
            continue
        drops.append(
            {
                "repo_id": str(repo_id),
                "first_score": round(first.score, 2),
                "last_score": round(last.score, 2),
                "drop": drop,
            }
        )
    drops.sort(key=lambda d: d["drop"], reverse=True)
    return drops[:top_n]


def compute_review_backlog(
    prs: list[OpenPrRow],
    *,
    backlog_days: int,
    as_of: datetime,
) -> list[dict]:
    """打开且尚未收到首评、创建距今超过 backlog_days 天的 PR。"""
    cutoff = as_of - timedelta(days=backlog_days)
    out: list[dict] = []
    for pr in prs:
        if pr.first_review_at is not None:
            continue
        if pr.created_at >= cutoff:
            continue
        out.append(
            {
                "repo_id": str(pr.repo_id),
                "owner": pr.owner,
                "name": pr.name,
                "full_name": _full_name(pr.owner, pr.name),
                "pr_number": pr.pr_number,
                "title": pr.title,
                "days_waiting": round(_days_since(pr.created_at, as_of)),
                "to": _to(pr.repo_id),
            }
        )
    return out


def compute_unlinked_prs(prs: list[OpenPrRow]) -> list[dict]:
    """打开且标题无 issue 号引用的 PR（近似口径）。"""
    out: list[dict] = []
    for pr in prs:
        if pr.title and _UNLINKED_PR_RE.search(pr.title):
            continue
        out.append(
            {
                "repo_id": str(pr.repo_id),
                "owner": pr.owner,
                "name": pr.name,
                "full_name": _full_name(pr.owner, pr.name),
                "pr_number": pr.pr_number,
                "title": pr.title,
                "to": _to(pr.repo_id),
            }
        )
    return out


def compute_slow_issue_response(
    rows: list[IssueResponseRow],
    *,
    slow_hours: float,
) -> list[dict]:
    """issue 关闭时长中位数超过 slow_hours 的仓库。"""
    out: list[dict] = []
    for row in rows:
        if row.median_hours > slow_hours:
            out.append(
                {
                    "repo_id": str(row.repo_id),
                    "owner": row.owner,
                    "name": row.name,
                    "full_name": _full_name(row.owner, row.name),
                    "median_hours": round(row.median_hours, 1),
                    "to": _to(row.repo_id),
                }
            )
    return out


def compute_recent_releases(
    merges: list[MergeRow],
    *,
    limit: int,
) -> list[dict]:
    """最近发布（近似：最近合并的 PR，按 merged_at 降序）。"""
    ordered = sorted(merges, key=lambda m: m.merged_at, reverse=True)
    return [
        {
            "repo_id": str(m.repo_id),
            "owner": m.owner,
            "name": m.name,
            "full_name": _full_name(m.owner, m.name),
            "pr_number": m.pr_number,
            "title": m.title,
            "merged_at": m.merged_at.isoformat(),
            "to": _to(m.repo_id),
        }
        for m in ordered[:limit]
    ]


# ---------------------------------------------------------------------------
# 组装（路由器调用；测试直接以 fixture 驱动）
# ---------------------------------------------------------------------------


def build_workbench(
    *,
    org: str | None,
    repos: list[RepoRow],
    last_commit_by_repo: dict[int, datetime],
    health_score_rows: list[HealthScoreRow],
    open_prs: list[OpenPrRow],
    issue_response_rows: list[IssueResponseRow],
    unclassified_count: int | None,
    merges: list[MergeRow],
    config: WorkbenchConfig,
    as_of: datetime,
) -> dict:
    """把原始行折叠成工作台响应体（不含统一信封）。"""
    stalled = compute_stalled_repos(
        repos, last_commit_by_repo, window_days=config.window_days, as_of=as_of
    )
    drops = compute_health_drops(health_score_rows, top_n=config.health_drop_top_n)
    # health_drops 明细需要仓库名与跳转目标，用 repos 补全（score_rows 只带 repo_id）。
    repo_by_id = {r.repo_id: r for r in repos}
    for d in drops:
        repo = repo_by_id.get(int(d["repo_id"]))
        if repo is not None:
            d["owner"] = repo.owner
            d["name"] = repo.name
            d["full_name"] = _full_name(repo.owner, repo.name)
        d["to"] = _to(int(d["repo_id"]))
    backlog = compute_review_backlog(
        open_prs, backlog_days=config.review_backlog_days, as_of=as_of
    )
    unlinked = compute_unlinked_prs(open_prs)
    slow = compute_slow_issue_response(issue_response_rows, slow_hours=config.slow_response_hours)
    releases = compute_recent_releases(merges, limit=config.list_limit)

    # 清单卡上限：停滞/下滑各取前 list_limit 条（health_drops 的 top_n 已满足 TOP3 口径，
    # 完整清单用于「健康度下滑 TOP10」卡片时再截断到 list_limit）。
    stalled_list = sorted(
        stalled, key=lambda d: (d["days_since_commit"] is None, -(d["days_since_commit"] or 0))
    )

    return {
        "org": org,
        "window_days": config.window_days,
        "thresholds": {
            "window_days": config.window_days,
            "review_backlog_days": config.review_backlog_days,
            "slow_response_hours": config.slow_response_hours,
            "health_drop_top_n": config.health_drop_top_n,
            "health_drop_dimension": config.health_drop_dimension,
            "list_limit": config.list_limit,
        },
        "stalled_repos": len(stalled),
        "health_drops": drops,
        "review_backlog": len(backlog),
        "unlinked_prs": len(unlinked),
        "slow_issue_response": len(slow),
        "unclassified_people": unclassified_count,
        # Phase 3 舆情接入后追加的外部舆情异常项目数；本 issue 只预留字段位，不实现。
        "sentiment_spike": None,
        "lists": {
            "stalled_repos": stalled_list[: config.list_limit],
            "health_drops": drops[: config.list_limit],
            "recent_releases": releases,
            "review_backlog": backlog[: config.list_limit],
            "unlinked_prs": unlinked[: config.list_limit],
            "slow_issue_response": slow[: config.list_limit],
        },
    }