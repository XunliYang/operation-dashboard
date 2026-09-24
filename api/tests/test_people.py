"""人员看板领域逻辑 + 路由（LEOY-6 验收 4·组织树 / 脱敏 / 归并状态机）。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.routers.deps import db_conn
from app.services.people import (
    MERGE_CONFIRMED,
    MERGE_PENDING,
    MERGE_REJECTED,
    TIER_ACTIVE,
    TIER_CHURNED,
    TIER_CORE,
    TIER_OCCASIONAL,
    MemberActivity,
    MemberRow,
    OrgRow,
    aggregate_contributions,
    build_canonical_map,
    build_org_board,
    classify_tiers,
    maintainer_alerts,
    resolve_canonical,
)

NOW = datetime(2026, 9, 21, 12, 0, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# 身份归并状态机（验收 4）
# ---------------------------------------------------------------------------


def test_build_canonical_map_only_confirmed_rows_fold():
    rows = [(1, 2, MERGE_CONFIRMED), (3, 4, MERGE_PENDING), (5, 6, MERGE_REJECTED)]
    assert build_canonical_map(rows) == {2: 1}


def test_resolve_canonical_identity():
    assert resolve_canonical(2, {2: 1}) == 1
    assert resolve_canonical(1, {}) == 1


def test_aggregate_confirmed_merge_changes_org_share():
    contributions = {1: 10, 2: 20}
    org_of = {1: "openan", 2: "huawei"}

    # pending / rejected：不折叠，占比不变
    assert aggregate_contributions(contributions, org_of, {}) == {"openan": 10, "huawei": 20}

    # confirmed：merged(2) 并入 canonical(1)，贡献全部归 openan
    assert aggregate_contributions(contributions, org_of, {2: 1}) == {"openan": 30}


def test_aggregate_rejected_merge_has_no_effect():
    contributions = {1: 10, 2: 20}
    org_of = {1: "openan", 2: "huawei"}
    # rejected 状态不进入 canonical_map（build_canonical_map 只取 confirmed）
    assert aggregate_contributions(contributions, org_of, {}) == {"openan": 10, "huawei": 20}


# ---------------------------------------------------------------------------
# 活跃度分层 + 停滞告警
# ---------------------------------------------------------------------------


def _members() -> list[MemberActivity]:
    # 10 人：核心 = Top 20%（2 人）；再按最近活跃天数分层
    return [
        MemberActivity(id=1, contributions=100, days_since_active=2),   # core, active
        MemberActivity(id=2, contributions=90, days_since_active=45),   # core, 停滞→告警
        MemberActivity(id=3, contributions=50, days_since_active=5),    # active
        MemberActivity(id=4, contributions=40, days_since_active=10),   # active
        MemberActivity(id=5, contributions=30, days_since_active=60),   # occasional
        MemberActivity(id=6, contributions=20, days_since_active=75),   # occasional
        MemberActivity(id=7, contributions=10, days_since_active=120),  # churned
        MemberActivity(id=8, contributions=5, days_since_active=200),   # churned
        MemberActivity(id=9, contributions=0, days_since_active=None),  # active（无数据）
        MemberActivity(id=10, contributions=15, days_since_active=150), # churned
    ]


def test_classify_tiers_assigns_core_top20_and_activity_bands():
    tiers = classify_tiers(_members())
    assert tiers[1] == TIER_CORE
    assert tiers[2] == TIER_CORE
    assert tiers[3] == TIER_ACTIVE
    assert tiers[5] == TIER_OCCASIONAL
    assert tiers[7] == TIER_CHURNED
    assert tiers[9] == TIER_ACTIVE  # 无活动数据不当流失
    # 核心恰好 2 人（10 人 * 20%）
    assert sum(1 for t in tiers.values() if t == TIER_CORE) == 2


def test_maintainer_alerts_flags_core_member_inactive_over_30_days():
    alerts = maintainer_alerts(_members())
    alerted_ids = {a["id"] for a in alerts}
    # id=2 是核心层且 45 天无活动 → 告警；id=7 虽 120 天无活动但非核心/维护者 → 不告警
    assert 2 in alerted_ids
    assert 7 not in alerted_ids
    # 按无活动天数降序
    days = [a["days_inactive"] for a in alerts]
    assert days == sorted(days, reverse=True)


# ---------------------------------------------------------------------------
# 组织树聚合
# ---------------------------------------------------------------------------


def _board_fixture():
    orgs = [
        OrgRow(1, "OpenAN", "org", "manual_yaml", None),
        OrgRow(2, "core", "team", None, 1),
    ]
    members = [
        MemberRow(1, "alice", "a***@openan.org", "alice@openan.org", NOW - timedelta(days=2), 1, "maintainer", 1.0, "manual_yaml", 100),
        MemberRow(2, "bob", "b***@openan.org", "bob@openan.org", NOW - timedelta(days=45), 2, "maintainer", 0.8, "api", 60),
        MemberRow(3, "carol", "c***@huawei.com", "carol@huawei.com", NOW - timedelta(days=3), 1, None, 0.6, "email_domain", 40),
        MemberRow(4, "dave", "d***@openan.org", None, None, None, None, None, None, 0),  # 待归类 + 无明文邮箱
    ]
    return orgs, members


def test_build_org_board_counts_unclassified_and_builds_tree():
    orgs, members = _board_fixture()
    board = build_org_board(orgs, members, [], as_of=NOW)

    assert board["summary"]["total_contributors"] == 4
    assert board["summary"]["unclassified_count"] == 1
    assert len(board["orgs"]) == 1
    root = board["orgs"][0]
    assert root["name"] == "OpenAN"
    assert root["member_count"] == 3  # alice + carol + (team: bob)
    assert len(root["teams"]) == 1
    assert root["teams"][0]["name"] == "core"
    # 待归类显式呈现
    assert board["unclassified"][0]["login"] == "dave"


def test_build_org_board_confirmed_merge_folds_identity():
    orgs, members = _board_fixture()
    # 确认归并：dave(4) → alice(1)。dave 原本待归类，合并后并入 alice，待归类清零。
    merges = [(1, 4, MERGE_CONFIRMED)]
    board = build_org_board(orgs, members, merges, as_of=NOW)

    assert board["summary"]["total_contributors"] == 3
    assert board["summary"]["unclassified_count"] == 0
    assert board["summary"]["alerts"]  # bob 核心层停滞 → 有告警


# ---------------------------------------------------------------------------
# 路由（fake conn 冒烟）
# ---------------------------------------------------------------------------


class _Row:
    def __init__(self, *vals):
        self._vals = tuple(vals)

    def __getitem__(self, i):
        return self._vals[i]


class _FakeConn:
    def __init__(self):
        self._responses: dict[str, list[tuple]] = {}
        self.executed: list[str] = []
        self.committed = False

    def set(self, key: str, rows: list[tuple]) -> None:
        self._responses[key] = rows

    def execute(self, sql: str, params=None):
        self.executed.append(sql)
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
        self.committed = True


def _install(fake: _FakeConn, app):
    def override():
        yield fake

    app.dependency_overrides[db_conn] = override


def _board_responses(fake: _FakeConn) -> None:
    fake.set(
        "SELECT org_id, name, kind, source, parent_id FROM dim_org",
        [(1, "OpenAN", "org", "manual_yaml", None)],
    )
    fake.set(
        "LEFT JOIN bridge_contributor_org b",
        [
            (1, "alice", "a***@openan.org", "alice@openan.org", NOW - timedelta(days=2), 1, "maintainer", 1.0, "manual_yaml"),
            (2, "bob", "b***@openan.org", "bob@openan.org", NOW - timedelta(days=45), 1, None, 0.8, "api"),
            (3, "carol", None, None, None, None, None, None, None),
        ],
    )
    fake.set("FROM fact_commit", [(1, 5), (2, 3)])
    fake.set("FROM fact_pull_request", [(1, 2)])
    fake.set("FROM fact_review", [(2, 1)])
    fake.set("SELECT canonical_id, merged_id, status FROM identity_merge", [])


def test_build_org_board_member_has_plaintext_email_and_null_when_absent():
    orgs, members = _board_fixture()
    board = build_org_board(orgs, members, [], as_of=NOW)

    by_login = {m["login"]: m for m in board["orgs"][0]["members"]}
    # 成员行回吐明文 email（email_plain），脱敏形另立 email_masked
    assert by_login["alice"]["email"] == "alice@openan.org"
    assert by_login["alice"]["email_masked"] == "a***@openan.org"
    # email_plain 为空 → email 为 null，且不回退到脱敏形
    unclassified = {m["login"]: m for m in board["unclassified"]}
    assert unclassified["dave"]["email"] is None
    assert unclassified["dave"]["email_masked"] == "d***@openan.org"


def test_list_orgs_returns_envelope_with_unclassified(client, app):
    fake = _FakeConn()
    _board_responses(fake)
    _install(fake, app)

    resp = client.get("/dashboard/orgs")

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["summary"]["unclassified_count"] == 1
    assert body["data"]["orgs"][0]["name"] == "OpenAN"


def test_contributor_detail_plaintext_email_and_contributions(client, app):
    fake = _FakeConn()
    fake.set(
        "FROM dim_contributor WHERE contributor_id",
        [(7, "zhang", "Zhang Wei", "zhang@huawei.com", "z***@huawei.com", "Huawei", None, None)],
    )
    fake.set(
        "FROM bridge_contributor_org b",
        [(3, "华为", "org", "huawei", None, 0.6, "email_domain")],
    )
    fake.set("FROM fact_commit fc JOIN dim_repo", [(165, "project-openan", "registry-center")])
    fake.set("SELECT COUNT(*)::int FROM fact_commit", [(10,)])
    fake.set("SELECT COUNT(*)::int FROM fact_pull_request", [(3,)])
    fake.set("SELECT COUNT(*)::int FROM fact_review", [(5,)])
    fake.set("SELECT COUNT(*)::int FROM fact_issue", [(4,)])
    fake.set("SELECT COUNT(*)::int FROM fact_wiki_revision", [(0,)])
    fake.set("COALESCE(SUM(additions)", [(100, 20)])
    _install(fake, app)

    resp = client.get("/dashboard/contributors/7")

    body = resp.json()
    assert body["code"] == 0
    # 需求方 2026-09-22 拍板：email 取明文 email_plain，脱敏形另立 email_masked。
    assert body["data"]["email"] == "zhang@huawei.com"
    assert body["data"]["email_masked"] == "z***@huawei.com"
    assert body["data"]["activity"] == {"commits": 10, "prs": 3, "reviews": 5}

    contributions = body["data"]["contributions"]
    assert contributions["metrics"]["commits"] == 10
    assert contributions["metrics"]["prs"] == 3
    assert contributions["metrics"]["issues"] == 4
    assert contributions["metrics"]["wiki"] == 0
    assert contributions["metrics"]["code_additions"] == 100
    assert contributions["metrics"]["code_deletions"] == 20
    assert contributions["metrics"]["code_total"] == 120
    assert contributions["by_org"][0]["key"] == "huawei"
    assert contributions["by_org"][0]["name"] == "华为"
    assert contributions["by_repo"] == []


def test_identity_merge_confirm_transitions_pending_to_confirmed(client, app):
    fake = _FakeConn()
    fake.set(
        "UPDATE identity_merge SET status",
        [(11, 1, 2, MERGE_CONFIRMED)],
    )
    _install(fake, app)

    resp = client.post("/admin/identity-merge", json={"merge_id": 11, "action": "confirm"})

    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["status"] == MERGE_CONFIRMED
    assert body["data"]["changed"] is True
    assert fake.committed is True


def test_identity_merge_reject_transitions_pending_to_rejected(client, app):
    fake = _FakeConn()
    fake.set("UPDATE identity_merge SET status", [(12, 1, 2, MERGE_REJECTED)])
    _install(fake, app)

    resp = client.post("/admin/identity-merge", json={"merge_id": 12, "action": "reject"})

    assert resp.json()["data"]["status"] == MERGE_REJECTED
    assert resp.json()["data"]["changed"] is True


def test_identity_merge_already_resolved_conflicts(client, app):
    fake = _FakeConn()
    fake.set("UPDATE identity_merge SET status", [])  # 无 pending 行可更新
    fake.set("SELECT status FROM identity_merge WHERE merge_id", [(MERGE_CONFIRMED,)])
    _install(fake, app)

    resp = client.post("/admin/identity-merge", json={"merge_id": 13, "action": "confirm"})

    body = resp.json()
    assert resp.status_code == 409
    assert body["data"]["changed"] is False
    assert body["data"]["status"] == MERGE_CONFIRMED