"""工作台领域逻辑 + 路由（LEOY-12 验收 4·六项指标 / 4·阈值可复现 / 5·边界不崩）。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.routers.deps import db_conn
from app.services.workbench import (
    HealthScoreRow,
    IssueResponseRow,
    MergeRow,
    OpenPrRow,
    RepoRow,
    WorkbenchConfig,
    build_workbench,
    compute_health_drops,
    compute_stalled_repos,
    compute_unlinked_prs,
)

NOW = datetime(2026, 9, 21, 12, 0, 0, tzinfo=UTC)
D0 = (NOW - timedelta(days=6)).date()
D1 = NOW.date()

CONFIG = WorkbenchConfig(
    window_days=7,
    review_backlog_days=3,
    slow_response_hours=48,
    health_drop_top_n=3,
    health_drop_dimension="composite",
    list_limit=10,
)


def _fixture():
    repos = [
        RepoRow(1, "project-openan", "a", False),
        RepoRow(2, "project-openan", "b", False),
        RepoRow(3, "project-openan", "c", True),   # archived → 各处排除
        RepoRow(4, "project-openan", "d", False),
    ]
    last_commit = {
        1: NOW - timedelta(days=10),  # 停滞（>7 天）
        2: NOW - timedelta(days=1),   # 活跃
        # 4 无提交 → 停滞；3 archived 不参与
    }
    health_rows = [
        HealthScoreRow(1, D0, 80.0), HealthScoreRow(1, D1, 60.0),   # 跌 20
        HealthScoreRow(2, D0, 50.0), HealthScoreRow(2, D1, 55.0),   # 涨 → 不计
        HealthScoreRow(4, D0, 90.0), HealthScoreRow(4, D1, 75.0),   # 跌 15
    ]
    open_prs = [
        OpenPrRow(1, "project-openan", "a", 10, "feat: x", NOW - timedelta(days=10), None),
        OpenPrRow(1, "project-openan", "a", 11, "fix bug #42", NOW - timedelta(days=2), None),
        OpenPrRow(2, "project-openan", "b", 20, "chore: y", NOW - timedelta(days=5), None),
        OpenPrRow(2, "project-openan", "b", 21, "docs", NOW - timedelta(days=1), NOW - timedelta(hours=6)),
    ]
    issue_rows = [
        IssueResponseRow(1, "project-openan", "a", 50.0),  # 慢（>48h）
        IssueResponseRow(2, "project-openan", "b", 10.0),  # 快
    ]
    merges = [
        MergeRow(1, "project-openan", "a", 9, "release a", NOW - timedelta(days=5)),
        MergeRow(2, "project-openan", "b", 21, "release b", NOW - timedelta(days=2)),
    ]
    return repos, last_commit, health_rows, open_prs, issue_rows, merges


def _build(**overrides):
    repos, last_commit, health_rows, open_prs, issue_rows, merges = _fixture()
    kwargs = dict(
        org="openan",
        repos=repos,
        last_commit_by_repo=last_commit,
        health_score_rows=health_rows,
        open_prs=open_prs,
        issue_response_rows=issue_rows,
        unclassified_count=None,
        merges=merges,
        config=CONFIG,
        as_of=NOW,
    )
    kwargs.update(overrides)
    return build_workbench(**kwargs)


# ---------------------------------------------------------------------------
# 六项指标（固定 fixture，验收 4）
# ---------------------------------------------------------------------------


def test_six_metrics_from_fixture():
    data = _build()

    assert data["stalled_repos"] == 2           # repo 1（10 天）+ repo 4（无提交）
    assert data["review_backlog"] == 2          # PR #10（10 天）+ #20（5 天），均无首评
    assert data["unlinked_prs"] == 3            # #10 / #20 / #21 标题无 issue 号
    assert data["slow_issue_response"] == 1     # repo 1 中位 50h > 48h
    assert data["unclassified_people"] is None  # Phase 2 未写入分类数据

    drops = data["health_drops"]
    assert [d["repo_id"] for d in drops] == ["1", "4"]
    assert drops[0]["drop"] == 20.0
    assert drops[1]["drop"] == 15.0

    assert data["org"] == "openan"
    assert data["thresholds"]["window_days"] == 7


def test_lists_are_renderable():
    data = _build()
    lists = data["lists"]
    assert len(lists["stalled_repos"]) == 2
    assert lists["stalled_repos"][0]["full_name"] == "project-openan/a"
    assert lists["stalled_repos"][0]["to"] == "/repos/1"
    # 无提交的 repo 4 排在有天数之后
    assert lists["stalled_repos"][1]["days_since_commit"] is None

    assert len(lists["health_drops"]) == 2
    assert len(lists["recent_releases"]) == 2
    assert lists["recent_releases"][0]["repo_id"] == "2"  # 最近合并在前
    assert lists["recent_releases"][0]["title"] == "release b"

    assert len(lists["review_backlog"]) == 2
    assert len(lists["unlinked_prs"]) == 3
    assert len(lists["slow_issue_response"]) == 1


def test_archived_repos_excluded_from_stalled():
    repos, last_commit, health_rows, open_prs, issue_rows, merges = _fixture()
    stalled = compute_stalled_repos(
        repos, last_commit, window_days=7, as_of=NOW
    )
    ids = {s["repo_id"] for s in stalled}
    assert "3" not in ids  # archived


# ---------------------------------------------------------------------------
# 阈值可复现（验收 4：改阈值 → 结果变）
# ---------------------------------------------------------------------------


def test_slow_response_threshold_changes_result():
    slow_48 = _build(config=WorkbenchConfig(slow_response_hours=48))
    slow_60 = _build(config=WorkbenchConfig(slow_response_hours=60))
    assert slow_48["slow_issue_response"] == 1
    assert slow_60["slow_issue_response"] == 0


def test_backlog_threshold_changes_result():
    b3 = _build(config=WorkbenchConfig(review_backlog_days=3))
    b11 = _build(config=WorkbenchConfig(review_backlog_days=11))
    assert b3["review_backlog"] == 2
    assert b11["review_backlog"] == 0  # #10 恰 10 天、#20 5 天，< 11 天都不满足严格小于


def test_health_drop_top_n_changes_result():
    repos, last_commit, health_rows, open_prs, issue_rows, merges = _fixture()
    top3 = compute_health_drops(health_rows, top_n=3)
    top1 = compute_health_drops(health_rows, top_n=1)
    assert len(top3) == 2
    assert len(top1) == 1
    assert top1[0]["repo_id"] == "1"


def test_window_threshold_changes_stalled_result():
    w7 = _build(config=WorkbenchConfig(window_days=7))
    w14 = _build(config=WorkbenchConfig(window_days=14))
    assert w7["stalled_repos"] == 2     # repo1（10 天）+ repo4（无提交）
    # 14 天窗口下 repo1（10 天）不再停滞，只剩无提交的 repo4
    assert w14["stalled_repos"] == 1


# ---------------------------------------------------------------------------
# 边界：空数据不崩（验收 5）
# ---------------------------------------------------------------------------


def test_empty_database_returns_zeros_and_empty_lists():
    data = build_workbench(
        org="openan",
        repos=[],
        last_commit_by_repo={},
        health_score_rows=[],
        open_prs=[],
        issue_response_rows=[],
        unclassified_count=None,
        merges=[],
        config=CONFIG,
        as_of=NOW,
    )
    assert data["stalled_repos"] == 0
    assert data["health_drops"] == []
    assert data["review_backlog"] == 0
    assert data["unlinked_prs"] == 0
    assert data["slow_issue_response"] == 0
    assert data["unclassified_people"] is None
    assert data["lists"]["stalled_repos"] == []
    assert data["lists"]["recent_releases"] == []


def test_compute_unlinked_prs_recognizes_issue_ref():
    prs = [
        OpenPrRow(1, "o", "a", 1, "closes #12 stuff", NOW, None),
        OpenPrRow(1, "o", "a", 2, "no reference", NOW, None),
    ]
    result = compute_unlinked_prs(prs)
    assert len(result) == 1
    assert result[0]["pr_number"] == 2


def _row(*vals):
    class R:
        def __getitem__(self, i):
            return vals[i]

    return R()


# ---------------------------------------------------------------------------
# 路由（fake conn 冒烟 + 参数校验，验收 3 / 5）
# ---------------------------------------------------------------------------


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
        return [_row(*r) for r in self._last]

    def commit(self):
        pass


def _install(fake, app):
    def override():
        yield fake

    app.dependency_overrides[db_conn] = override


def test_workbench_route_empty_db(client, app):
    fake = _FakeConn()
    fake.set("archived FROM dim_repo", [])
    fake.set("to_regclass('bridge_contributor_org')", [(False,)])  # Phase 2 未迁移 → null
    _install(fake, app)

    resp = client.get("/dashboard/workbench", params={"org": "openan", "window": "7d"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["stalled_repos"] == 0
    assert body["data"]["health_drops"] == []
    assert body["data"]["unclassified_people"] is None
    assert body["data"]["thresholds"]["window_days"] == 7


def test_workbench_route_invalid_window(client, app):
    fake = _FakeConn()
    _install(fake, app)
    resp = client.get("/dashboard/workbench", params={"org": "openan", "window": "0d"})
    assert resp.status_code == 400  # 不 500


def test_workbench_route_unknown_org(client, app):
    fake = _FakeConn()
    _install(fake, app)
    resp = client.get("/dashboard/workbench", params={"org": "no-such-org"})
    assert resp.status_code == 400