"""贡献度聚合领域逻辑 + 路由（LEOY-48）。

纯函数层测试：五口径 `metric_value`、三键全序 tie-break、`normalize_metric` 非法值、
`_unclassified` 分组存在性、`code = additions + deletions`。
路由冒烟：非法 metric/缺 scope → 400、不存在 scope → 404、summary 正常组装。
"""

from __future__ import annotations

import pytest

from app.routers.deps import db_conn
from app.services.contributions import (
    ContributionRow,
    build_groups,
    build_leaderboard,
    full_metrics,
    metric_value,
    normalize_metric,
    rank_contributors,
    summarize,
)


def _row(cid, *, org_key="huawei", metrics=None, **extra):
    login = extra.pop("login", f"user{cid}")
    email = extra.pop("email", f"user{cid}@huawei.com")
    email_masked = extra.pop("email_masked", "u***@huawei.com")
    org_display = extra.pop("org_display", "华为系" if org_key == "huawei" else None)
    org_source = extra.pop("org_source", "email_domain")
    org_confidence = extra.pop("org_confidence", 0.6)
    return ContributionRow(
        contributor_id=cid,
        login=login,
        email=email,
        email_masked=email_masked,
        org_key=org_key,
        metrics=metrics or {},
        org_display=org_display,
        org_source=org_source,
        org_confidence=org_confidence,
        **extra,
    )


# ---------------------------------------------------------------------------
# 口径归一
# ---------------------------------------------------------------------------


def test_metric_value_all_five_metrics():
    m = {
        "prs": 1,
        "commits": 10,
        "code_additions": 100,
        "code_deletions": 20,
        "issues": 3,
        "wiki": 2,
    }
    assert metric_value(m, "prs") == 1.0
    assert metric_value(m, "commits") == 10.0
    assert metric_value(m, "issues") == 3.0
    assert metric_value(m, "wiki") == 2.0
    assert metric_value(m, "code") == 120.0


def test_code_is_additions_plus_deletions():
    m = {"code_additions": 40, "code_deletions": 5}
    assert metric_value(m, "code") == 45.0
    assert full_metrics(m)["code_total"] == 45


def test_normalize_metric_valid_and_invalid():
    assert normalize_metric("CODE") == "code"
    assert normalize_metric(" Prs ") == "prs"
    for bad in ("bogus", "", None):
        with pytest.raises(ValueError):
            normalize_metric(bad)


# ---------------------------------------------------------------------------
# 排名：三键全序（metric 降序 → commits 降序 → contributor_id 升序）
# ---------------------------------------------------------------------------


def test_rank_tiebreak_metric_then_commits_then_id():
    rows = [
        _row(1, metrics={"prs": 5, "commits": 10}),
        _row(2, metrics={"prs": 5, "commits": 20}),
        _row(3, metrics={"prs": 7, "commits": 0}),
    ]
    ranked = rank_contributors(rows, metric="prs", limit=10)
    assert [r["contributor_id"] for r in ranked] == ["3", "2", "1"]


def test_rank_tiebreak_same_metric_and_commits_by_id_asc():
    rows = [
        _row(2, metrics={"commits": 5}),
        _row(1, metrics={"commits": 5}),
        _row(3, metrics={"commits": 10}),
    ]
    ranked = rank_contributors(rows, metric="commits", limit=10)
    assert [r["contributor_id"] for r in ranked] == ["3", "1", "2"]


def test_rank_assigns_rank_and_offset():
    rows = [_row(i, metrics={"commits": i}) for i in range(1, 6)]
    ranked = rank_contributors(rows, metric="commits", limit=2, offset=1)
    assert [r["rank"] for r in ranked] == [2, 3]
    assert ranked[0]["contributor_id"] == "4"


# ---------------------------------------------------------------------------
# 分组：_unclassified 是显式分组，不静默丢弃
# ---------------------------------------------------------------------------


def test_build_groups_org_includes_unclassified():
    rows = [
        _row(1, org_key="huawei", metrics={"commits": 10}),
        _row(2, org_key="_unclassified", metrics={"commits": 3}),
    ]
    groups = build_groups(rows, group_by="org", metric="commits")
    keys = {g["key"] for g in groups}
    assert "_unclassified" in keys
    # 按 metric_value 降序
    assert [g["key"] for g in groups] == ["huawei", "_unclassified"]


def test_build_groups_repo_seeds_zero_groups_from_catalog():
    rows = [
        _row(1, metrics={"commits": 4}, repo_id=165, repo_name="a", repo_full_name="o/a"),
    ]
    catalog = [
        {"id": "165", "name": "a", "full_name": "o/a"},
        {"id": "166", "name": "b", "full_name": "o/b"},
    ]
    groups = build_groups(rows, group_by="repo", metric="commits", repo_catalog=catalog)
    assert {g["key"] for g in groups} == {"165", "166"}
    by_key = {g["key"]: g for g in groups}
    assert by_key["165"]["metric_value"] == 4
    assert by_key["166"]["metric_value"] == 0
    assert by_key["166"]["contributor_count"] == 0


def test_summarize_shape_and_totals():
    rows = [
        _row(1, org_key="huawei", metrics={"commits": 10, "prs": 2}),
        _row(2, org_key="huawei", metrics={"commits": 5, "prs": 1}),
        _row(3, org_key="zte", metrics={"commits": 1, "prs": 0}),
    ]
    data = summarize(
        rows,
        group_by="org",
        metric="commits",
        range_={"from": None, "to": "2026-09-22"},
        filters={},
    )
    assert data["group_by"] == "org"
    assert data["metric"] == "commits"
    assert data["range"]["to"] == "2026-09-22"
    assert data["metric_meta"]["key"] == "commits"
    assert data["totals"]["metric_value"] == 16
    assert data["totals"]["contributor_count"] == 3
    assert data["totals"]["group_count"] == 2


def test_summarize_wiki_totals_include_unattributed_only_for_wiki():
    rows = [
        _row(1, org_key="huawei", metrics={"wiki": 3, "commits": 2}),
        _row(2, org_key="huawei", metrics={"wiki": 1, "commits": 1}),
    ]
    wiki = summarize(
        rows,
        group_by="org",
        metric="wiki",
        range_={"from": None, "to": None},
        filters={},
        unattributed_wiki=7,
    )
    assert wiki["totals"]["metric_value"] == 3 + 1 + 7
    # 其它口径不受无归属 wiki 影响
    commits = summarize(
        rows,
        group_by="org",
        metric="commits",
        range_={"from": None, "to": None},
        filters={},
        unattributed_wiki=7,
    )
    assert commits["totals"]["metric_value"] == 3


def test_build_leaderboard_repos_avatar_and_rank():
    rows = [
        _row(
            2,
            login="ivo",
            email="i@huawei.com",
            email_masked="i***@huawei.com",
            metrics={"commits": 5},
            repo_id=1,
            repo_name="r",
            repo_full_name="o/r",
        ),
    ]
    data = build_leaderboard(
        rows,
        dimension="project",
        scope=None,
        metric="commits",
        range_={"from": None, "to": None},
        limit=50,
        offset=0,
    )
    assert data["dimension"] == "project"
    assert data["total_contributors"] == 1
    c = data["contributors"][0]
    assert c["rank"] == 1
    assert c["avatar_url"] == "https://github.com/ivo.png"
    assert c["email"] == "i@huawei.com"
    assert c["email_masked"] == "i***@huawei.com"
    assert c["repos"] == [{"id": "1", "full_name": "o/r", "metric_value": 5}]


# ---------------------------------------------------------------------------
# 路由冒烟（fake conn）
# ---------------------------------------------------------------------------


class _Row:
    def __init__(self, *vals):
        self._vals = tuple(vals)

    def __getitem__(self, i):
        return self._vals[i]


class _FakeConn:
    def __init__(self):
        self._responses: dict[str, list[tuple]] = {}

    def set(self, key: str, rows: list[tuple]) -> None:
        self._responses[key] = rows

    def execute(self, sql: str, params=None):
        for key, rows in self._responses.items():
            if key in sql:
                self._last = rows
                return self
        self._last = []
        return self

    def fetchone(self):
        return self._last[0] if self._last else None

    def fetchall(self):
        return [_Row(*r) for r in self._last]

    def commit(self):
        pass


def _install(fake: _FakeConn, app):
    def override():
        yield fake

    app.dependency_overrides[db_conn] = override


def test_summary_invalid_metric_returns_400(client, app):
    _install(_FakeConn(), app)
    resp = client.get("/dashboard/contributions/summary", params={"group_by": "org", "metric": "bogus"})
    assert resp.status_code == 400
    assert resp.json()["code"] == 40000


def test_summary_invalid_group_by_returns_400(client, app):
    _install(_FakeConn(), app)
    resp = client.get(
        "/dashboard/contributions/summary", params={"group_by": "team", "metric": "commits"}
    )
    assert resp.status_code == 400


def test_leaderboard_missing_scope_returns_400(client, app):
    _install(_FakeConn(), app)
    # 验收 #5：缺 scope 且缺 metric 时仍须 400（scope 校验先于 metric）
    resp = client.get("/dashboard/contributions/leaderboard", params={"dimension": "org"})
    assert resp.status_code == 400


def test_leaderboard_unknown_repo_scope_returns_404(client, app):
    fake = _FakeConn()
    _install(fake, app)
    # 验收 #5：scope 不存在且缺 metric 时仍须 404（scope 解析先于 metric）
    resp = client.get(
        "/dashboard/contributions/leaderboard",
        params={"dimension": "repo", "scope": "99999"},
    )
    assert resp.status_code == 404


def test_summary_happy_path(client, app):
    fake = _FakeConn()
    fake.set(
        "FROM dim_repo ORDER BY repo_id",
        [(165, "project-openan", "registry-center")],
    )
    fake.set(
        "FROM dim_repo WHERE repo_id = ANY",
        [(165, "project-openan", "registry-center")],
    )
    fake.set(
        "LEFT JOIN bridge_contributor_org b",
        [
            (10, "zhang", "Zhang Wei", "zhang@huawei.com", "z***@huawei.com",
             None, None, "huawei", "华为系", "email_domain", 0.6),
        ],
    )
    fake.set("FROM fact_commit WHERE author_id IS NOT NULL", [(10, 165, 5)])
    fake.set("FROM fact_pull_request WHERE author_id IS NOT NULL", [(10, 165, 2)])
    fake.set("FROM fact_issue WHERE author_id IS NOT NULL", [(10, 165, 1)])
    fake.set("FROM fact_contributor_code_weekly", [(10, 165, 100, 20)])
    fake.set("FROM fact_wiki_revision WHERE author_id IS NOT NULL", [])
    fake.set("FROM fact_wiki_revision WHERE author_id IS NULL", [(0,)])
    _install(fake, app)

    resp = client.get(
        "/dashboard/contributions/summary", params={"group_by": "repo", "metric": "code"}
    )

    body = resp.json()
    assert body["code"] == 0
    data = body["data"]
    assert data["group_by"] == "repo"
    assert data["metric_meta"]["key"] == "code"
    assert data["totals"]["metric_value"] == 120
    assert data["totals"]["group_count"] == 1
    group = data["groups"][0]
    assert group["key"] == "165"
    assert group["full_name"] == "project-openan/registry-center"
    assert group["metrics"]["code_total"] == 120
    assert group["metric_value"] == 120
