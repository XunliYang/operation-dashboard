"""贡献度聚合领域逻辑（LEOY-48 · 贡献度 S2）。

纯函数层，不触 DB：路由器把 SQL 结果转成 `ContributionRow` 后调用；单元测试直接
以 fixture 数据驱动（与 `people.py` / `workbench.py` 同法）。

口径（与既有口径对齐，见 `api/app/services/metrics.py` 与 `config/health_weights.yaml`）：

- `commits` 含 merge commit：`fact_commit` 全量计数，不筛 `is_merge`（与
  `api/app/routers/repos.py:222-228`、`api/app/services/metrics.py:52-57` 一致；
  改口径会静默改变已有健康分）。
- `code = code_additions + code_deletions`：`fact_contributor_code_weekly` 的两列之和。
- `issues` 只计 `is_pull_request = false`（PR 是另一口径）。
- `wiki`：`fact_wiki_revision.author_id IS NULL` 的修订（S1 无邮箱匹配）只计入
  口径总量、不计入任何个人排名——本模块只按 `contributor_id` 聚合，天然满足这一点；
  下游不得把榜单里的 `wiki` 读成「该贡献者的全部 wiki 修订」。

排序决定性：`metric_value` 降序 → `commits` 降序 → `contributor_id` 升序。三键全序，
保证任意次调用结果一致（可复现是既有约定，见 `config/health_weights.yaml:1-10`）。

未归类是显式分组：`org_key == "_unclassified"` 复用 `org_classifier.py` 的
`UNCLASSIFIED_KEY`，作为「待归类」出现在榜单/分组里，不静默丢弃。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.services.org_classifier import UNCLASSIFIED_KEY, UNCLASSIFIED_NAME

METRICS = ("prs", "commits", "code", "issues", "wiki")

# 指标字典的取值类型：内部计数可为 int / float，接口层归一为 float。
Metrics = Mapping[str, float | int]

# 各口径的展示元数据（summary 响应的 `metric_meta`）。
METRIC_META: dict[str, dict[str, str]] = {
    "prs": {"key": "prs", "label": "PR 数", "unit": "个"},
    "commits": {"key": "commits", "label": "Commit 数", "unit": "个"},
    "code": {"key": "code", "label": "代码量", "unit": "行"},
    "issues": {"key": "issues", "label": "Issue 数", "unit": "个"},
    "wiki": {"key": "wiki", "label": "Wiki 修订", "unit": "条"},
}


@dataclass(frozen=True)
class ContributionRow:
    """一行原始计数。

    `repo_id` / `repo_full_name` 为空表示「贡献者聚合行」（整体 / org 维度）；
    非空表示「(贡献者, 仓库) 切片」——repo 维度分组与榜单 `repos[]` 的原料。
    `metrics` 为五口径原始计数：`prs / commits / code_additions / code_deletions /
    issues / wiki`（不含派生的 `code_total`，由 `full_metrics()` 计算）。
    """

    contributor_id: int
    login: str | None
    email: str | None
    email_masked: str | None
    org_key: str
    metrics: dict[str, float]
    display_name: str | None = None
    org_display: str | None = None
    org_source: str | None = None
    org_confidence: float | None = None
    first_seen_at: str | None = None
    last_seen_at: str | None = None
    repo_id: int | None = None
    repo_name: str | None = None
    repo_full_name: str | None = None


# ---------------------------------------------------------------------------
# 口径归一
# ---------------------------------------------------------------------------


def normalize_metric(metric: str | None) -> str:
    """非法 / 空口径抛 `ValueError`（由 router 转 400）。"""
    key = (metric or "").strip().lower()
    if key not in METRICS:
        raise ValueError(f"invalid metric: {metric!r}")
    return key


def metric_value(metrics: Metrics, metric: str) -> float:
    """按口径取单值；`code` 归一为 `code_additions + code_deletions`。"""
    if metric == "code":
        return float(metrics.get("code_additions", 0.0)) + float(
            metrics.get("code_deletions", 0.0)
        )
    return float(metrics.get(metric, 0.0))


def full_metrics(metrics: Metrics) -> dict[str, int]:
    """补齐派生的 `code_total`，并把五口径渲染为整型（计数天然为整数）。"""
    additions = int(metrics.get("code_additions", 0))
    deletions = int(metrics.get("code_deletions", 0))
    return {
        "prs": int(metrics.get("prs", 0)),
        "commits": int(metrics.get("commits", 0)),
        "code_additions": additions,
        "code_deletions": deletions,
        "code_total": additions + deletions,
        "issues": int(metrics.get("issues", 0)),
        "wiki": int(metrics.get("wiki", 0)),
    }


def _is_zero(metrics: Metrics) -> bool:
    return all(float(v) == 0.0 for v in metrics.values())


# ---------------------------------------------------------------------------
# 行归并（(contributor, repo) 切片 → 贡献者聚合）
# ---------------------------------------------------------------------------


def _merge_metrics(*dicts: Metrics) -> dict[str, float]:
    out: dict[str, float] = {}
    for d in dicts:
        for k, v in d.items():
            out[k] = out.get(k, 0.0) + float(v)
    return out


def _merge_rows(rows: list[ContributionRow]) -> ContributionRow:
    base = rows[0]
    return ContributionRow(
        contributor_id=base.contributor_id,
        login=base.login,
        email=base.email,
        email_masked=base.email_masked,
        org_key=base.org_key,
        metrics=_merge_metrics(*(r.metrics for r in rows)),
        display_name=base.display_name,
        org_display=base.org_display,
        org_source=base.org_source,
        org_confidence=base.org_confidence,
        first_seen_at=base.first_seen_at,
        last_seen_at=base.last_seen_at,
    )


def _active(rows: list[ContributionRow]) -> list[ContributionRow]:
    """缺失即跳过：五口径全为 0 且无任何活动的行排除。"""
    return [r for r in rows if not _is_zero(r.metrics)]


def _group(rows: list[ContributionRow]) -> dict[int, list[ContributionRow]]:
    out: dict[int, list[ContributionRow]] = {}
    for r in rows:
        out.setdefault(r.contributor_id, []).append(r)
    return out


def _rank_tuple(metrics: dict[str, float], contributor_id: int, metric: str) -> tuple:
    """三键全序：metric_value 降序 → commits 降序 → contributor_id 升序。"""
    return (
        -metric_value(metrics, metric),
        -float(metrics.get("commits", 0.0)),
        contributor_id,
    )


def _org_view(row: ContributionRow) -> dict:
    display = row.org_display
    if display is None:
        display = UNCLASSIFIED_NAME if row.org_key == UNCLASSIFIED_KEY else row.org_key
    return {
        "key": row.org_key,
        "display": display,
        "source": row.org_source,
        "confidence": row.org_confidence,
    }


def _avatar_url(login: str | None) -> str | None:
    return f"https://github.com/{login}.png" if login else None


# ---------------------------------------------------------------------------
# 贡献者入口 / 榜单
# ---------------------------------------------------------------------------


def _contributor_entries(rows: list[ContributionRow], metric: str) -> list[dict]:
    """(contributor, repo) 切片 → 每名贡献者的榜单视图（含 repos[] 明细）。"""
    entries: list[dict] = []
    for cid, rs in _group(rows).items():
        merged = _merge_rows(rs)
        repos = [
            {
                "id": str(r.repo_id),
                "full_name": r.repo_full_name,
                "metric_value": int(metric_value(r.metrics, metric)),
            }
            for r in rs
            if r.repo_id is not None
        ]
        repos.sort(key=lambda x: (-x["metric_value"], x["id"]))
        display_name = merged.display_name or merged.login
        entries.append(
            {
                "contributor_id": str(cid),
                "login": merged.login,
                "display_name": display_name,
                "avatar_url": _avatar_url(merged.login),
                "email": merged.email,
                "email_masked": merged.email_masked,
                "org": _org_view(merged),
                "metrics": full_metrics(merged.metrics),
                "metric_value": int(metric_value(merged.metrics, metric)),
                "first_seen_at": merged.first_seen_at,
                "last_seen_at": merged.last_seen_at,
                "repos": repos,
            }
        )
    entries.sort(
        key=lambda e: (
            -e["metric_value"],
            -e["metrics"]["commits"],
            int(e["contributor_id"]),
        )
    )
    return entries


def rank_contributors(
    rows: list[ContributionRow], *, metric: str, limit: int, offset: int = 0
) -> list[dict]:
    """按三键全序排名，返回 `rank` 从 `offset + 1` 递增的榜单切片。"""
    entries = _contributor_entries(_active(rows), metric)
    page = entries[offset : offset + limit]
    for i, entry in enumerate(page, start=offset + 1):
        entry["rank"] = i
    return page


# ---------------------------------------------------------------------------
# 汇总分组
# ---------------------------------------------------------------------------


def build_groups(
    rows: list[ContributionRow],
    *,
    group_by: str,
    metric: str,
    repo_catalog: list[dict] | None = None,
) -> list[dict]:
    """按组织 / 仓库把贡献者切片折叠成分组（按 metric_value 降序、key 升序返回）。"""
    rows = _active(rows)

    groups: dict = {}

    if group_by == "repo":
        # 先以仓库目录为底，保证「筛选后为 0 的仓库仍作为分组出现」。
        for repo in repo_catalog or []:
            rid = int(repo["id"])
            groups[rid] = {
                "key": str(rid),
                "kind": "repo",
                "name": repo.get("name"),
                "full_name": repo.get("full_name"),
                "contributor_ids": set(),
                "_metrics": {},
            }
        for r in rows:
            if r.repo_id is None:
                continue
            g = groups.setdefault(
                r.repo_id,
                {
                    "key": str(r.repo_id),
                    "kind": "repo",
                    "name": r.repo_name,
                    "full_name": r.repo_full_name,
                    "contributor_ids": set(),
                    "_metrics": {},
                },
            )
            g["contributor_ids"].add(r.contributor_id)
            g["_metrics"] = _merge_metrics(g["_metrics"], r.metrics)
    else:  # group_by == "org"
        for r in rows:
            g = groups.setdefault(
                r.org_key,
                {
                    "key": r.org_key,
                    "kind": "org",
                    "name": _org_view(r)["display"],
                    "full_name": None,
                    "contributor_ids": set(),
                    "_metrics": {},
                },
            )
            g["contributor_ids"].add(r.contributor_id)
            g["_metrics"] = _merge_metrics(g["_metrics"], r.metrics)

    out: list[dict] = []
    for g in groups.values():
        g["contributor_count"] = len(g["contributor_ids"])
        g["metric_value"] = int(metric_value(g["_metrics"], metric))
        g["metrics"] = full_metrics(g["_metrics"])
        del g["contributor_ids"]
        del g["_metrics"]
        out.append(g)
    out.sort(key=lambda g: (-g["metric_value"], g["key"]))
    return out


def summarize(
    rows: list[ContributionRow],
    *,
    group_by: str,
    metric: str,
    range_: dict,
    filters: dict,
    repo_catalog: list[dict] | None = None,
) -> dict:
    """贡献度汇总响应体（不含统一信封）。"""
    groups = build_groups(
        rows, group_by=group_by, metric=metric, repo_catalog=repo_catalog
    )
    active = _active(rows)
    contributors = {r.contributor_id for r in active}
    total_value = sum(metric_value(r.metrics, metric) for r in active)
    return {
        "group_by": group_by,
        "metric": metric,
        "range": range_,
        "metric_meta": METRIC_META[metric],
        "totals": {
            "metric_value": int(total_value),
            "contributor_count": len(contributors),
            "group_count": len(groups),
        },
        "groups": groups,
    }


def build_leaderboard(
    rows: list[ContributionRow],
    *,
    dimension: str,
    scope: str | None,
    metric: str,
    range_: dict,
    limit: int,
    offset: int,
) -> dict:
    """贡献者排名响应体（不含统一信封；`rows` 由 router 按维度/scope 预先裁剪）。"""
    contributors = rank_contributors(rows, metric=metric, limit=limit, offset=offset)
    return {
        "dimension": dimension,
        "scope": scope,
        "metric": metric,
        "range": range_,
        "total_contributors": len(_contributor_entries(_active(rows), metric)),
        "contributors": contributors,
    }