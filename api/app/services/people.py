"""人员看板领域逻辑（LEOY-6 · Phase 2）。

纯函数层，不触 DB：身份归并状态机、活跃度分层、停滞告警与组织树聚合。
路由器把 SQL 结果转成这里的入参后调用；单元测试直接以 fixture 数据驱动。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime

# ---------------------------------------------------------------------------
# 身份归并状态机
# ---------------------------------------------------------------------------

MERGE_PENDING = "pending"
MERGE_CONFIRMED = "confirmed"
MERGE_REJECTED = "rejected"
MERGE_STATUSES = (MERGE_PENDING, MERGE_CONFIRMED, MERGE_REJECTED)


def build_canonical_map(merge_rows) -> dict[int, int]:
    """把 `identity_merge` 行折叠成 {merged_id: canonical_id}（仅 confirmed 生效）。

    `merge_rows` 每条为 (canonical_id, merged_id, status)。rejected/pending 不参与映射
    —— 这正是「rejected 不生效」的落地处。
    """
    return {
        merged_id: canonical_id
        for canonical_id, merged_id, status in merge_rows
        if status == MERGE_CONFIRMED
    }


def resolve_canonical(contributor_id: int, canonical_map: dict[int, int]) -> int:
    """返回 contributor 的 canonical 身份 id（无归并时返回自身）。"""
    return canonical_map.get(contributor_id, contributor_id)


def aggregate_contributions(
    contributions: dict[int, int],
    org_of: dict[int, str],
    canonical_map: dict[int, int] | None = None,
) -> dict[str, int]:
    """按组织聚合贡献量，先做身份归并折叠。

    确认归并后，merged 身份的贡献并入 canonical 身份所在组织 → 组织贡献占比随之变化；
    未确认（pending/rejected）则 canonical_map 不含该对，占比不变。
    """
    canonical_map = canonical_map or {}
    out: dict[str, int] = {}
    for cid, count in contributions.items():
        eff = canonical_map.get(cid, cid)
        org = org_of.get(eff, org_of.get(cid))
        if org is None:
            continue
        out[org] = out.get(org, 0) + count
    return out


# ---------------------------------------------------------------------------
# 活跃度分层
# ---------------------------------------------------------------------------

TIER_CORE = "core"
TIER_ACTIVE = "active"
TIER_OCCASIONAL = "occasional"
TIER_CHURNED = "churned"
TIERS = (TIER_CORE, TIER_ACTIVE, TIER_OCCASIONAL, TIER_CHURNED)

MAINTAINER_ROLES = {"maintainer", "owner", "admin"}

ACTIVE_WINDOW_DAYS = 30
CHURN_DAYS = 90
CORE_FRACTION = 0.2
MAINTAINER_INACTIVE_DAYS = 30


@dataclass(frozen=True)
class MemberActivity:
    """一名成员的活动画像（贡献量 + 最近活跃天数 + 角色）。"""

    id: int
    contributions: int = 0
    days_since_active: float | None = None
    role: str | None = None


def classify_tiers(members: list[MemberActivity], core_fraction: float = CORE_FRACTION) -> dict[int, str]:
    """把成员分为 核心 / 活跃 / 偶发 / 流失 四层。

    - 核心：按贡献量降序取前 `core_fraction`（默认 Top 20%）；
    - 其余按最近活跃天数分层：≤30 天 → 活跃，≤90 天 → 偶发，>90 天 → 流失；
    - `days_since_active is None`（无活动数据）按活跃处理，不做流失误判。

    时间基准口径（LEOY-70）：活跃/偶发/流失的 `days_since_active` 以「真实最近
    活动时间」为准（即 `dim_contributor.last_seen_at`），该值只能由真实事件时间
    推进，采集侧的展示类 job（如 code_stats）不得写它。窗口常量
    `ACTIVE_WINDOW_DAYS=30` / `CHURN_DAYS=90` / `CORE_FRACTION=0.2` 为本模块单一
    来源，勿在别处散落硬编码。
    """
    if not members:
        return {}
    ranked = sorted(members, key=lambda m: m.contributions, reverse=True)
    core_count = max(1, math.ceil(len(ranked) * core_fraction))
    core_ids = {m.id for m in ranked[:core_count]}

    tiers: dict[int, str] = {}
    for m in members:
        if m.id in core_ids:
            tiers[m.id] = TIER_CORE
        elif m.days_since_active is None or m.days_since_active <= ACTIVE_WINDOW_DAYS:
            tiers[m.id] = TIER_ACTIVE
        elif m.days_since_active <= CHURN_DAYS:
            tiers[m.id] = TIER_OCCASIONAL
        else:
            tiers[m.id] = TIER_CHURNED
    return tiers


def maintainer_alerts(
    members: list[MemberActivity],
    *,
    inactive_days: int = MAINTAINER_INACTIVE_DAYS,
) -> list[dict]:
    """关键 maintainer 停滞告警：核心层或显式 maintainer 角色，连续 `inactive_days` 天无活动。

    返回按最近活跃天数降序排列的告警列表（不含未归类的身份字段，由调用方补充展示信息）。
    """
    tiers = classify_tiers(members)
    alerts = []
    for m in members:
        is_key = m.role in MAINTAINER_ROLES or tiers.get(m.id) == TIER_CORE
        if not is_key or m.days_since_active is None:
            continue
        if m.days_since_active > inactive_days:
            alerts.append({"id": m.id, "days_inactive": round(m.days_since_active)})
    alerts.sort(key=lambda a: a["days_inactive"], reverse=True)
    return alerts


# ---------------------------------------------------------------------------
# 组织树聚合（路由器 / 测试共用）
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OrgRow:
    org_id: int
    name: str
    kind: str
    source: str | None
    parent_id: int | None


@dataclass(frozen=True)
class MemberRow:
    contributor_id: int
    login: str | None
    email_masked: str | None
    email: str | None
    last_seen_at: datetime | None
    org_id: int | None
    role: str | None
    confidence: float | None
    source: str | None
    contributions: int = 0


def _days_since(last_seen_at: datetime | None, as_of: datetime) -> float | None:
    if last_seen_at is None:
        return None
    return (as_of - last_seen_at).total_seconds() / 86400.0


def build_org_board(
    orgs: list[OrgRow],
    members: list[MemberRow],
    merges,
    *,
    as_of: datetime | None = None,
) -> dict:
    """把组织树 + 成员 + 已确认归并折叠成看板 B 的响应体（不含信封）。

    - 已确认的身份归并：merged 身份并入 canonical，贡献合并、身份属性以 canonical 为准；
    - 未归入任何 bridge 的成员进入「待归类」；
    - 贡献占比按组织内（含团队）贡献量归一化；趋势（trend）由调用方基于时序另算，
      这里只返回当期快照字段。
    """
    as_of = as_of or datetime.now(UTC)
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=UTC)

    canonical_map = build_canonical_map(merges)

    # 1) 折叠身份归并
    folded: dict[int, dict] = {}
    for m in members:
        eff = canonical_map.get(m.contributor_id, m.contributor_id)
        slot = folded.setdefault(
            eff,
            {
                "contributor_id": eff,
                "login": None,
                "email_masked": None,
                "email": None,
                "last_seen_at": None,
                "org_id": None,
                "role": None,
                "confidence": None,
                "source": None,
                "contributions": 0,
            },
        )
        if m.contributor_id == eff:
            slot["login"] = m.login
            slot["email_masked"] = m.email_masked
            slot["email"] = m.email
            slot["org_id"] = m.org_id
            slot["role"] = m.role
            slot["confidence"] = m.confidence
            slot["source"] = m.source
        slot["contributions"] += m.contributions
        if m.last_seen_at and (
            slot["last_seen_at"] is None or m.last_seen_at > slot["last_seen_at"]
        ):
            slot["last_seen_at"] = m.last_seen_at

    # 2) 活跃度画像 + 分层 + 告警
    activities = [
        MemberActivity(
            id=slot["contributor_id"],
            contributions=slot["contributions"],
            days_since_active=_days_since(slot["last_seen_at"], as_of),
            role=slot["role"],
        )
        for slot in folded.values()
    ]
    tiers = classify_tiers(activities)
    alerts = maintainer_alerts(activities)

    # 3) 组织树与成员归组
    total_contributions = sum(slot["contributions"] for slot in folded.values())

    member_views: dict[int, dict] = {}
    for slot in folded.values():
        cid = slot["contributor_id"]
        member_views[cid] = {
            "id": str(cid),
            "login": slot["login"],
            "email_masked": slot["email_masked"],
            "email": slot["email"],
            "org_id": str(slot["org_id"]) if slot["org_id"] is not None else None,
            "role": slot["role"],
            "confidence": slot["confidence"],
            "source": slot["source"],
            "contributions": slot["contributions"],
            "contribution_share": (
                round(slot["contributions"] / total_contributions, 4)
                if total_contributions > 0
                else 0.0
            ),
            "tier": tiers.get(cid),
            "days_inactive": (
                round(_days_since(slot["last_seen_at"], as_of))
                if slot["last_seen_at"] is not None
                else None
            ),
        }

    def _direct(org: OrgRow) -> list[dict]:
        return [
            member_views[slot["contributor_id"]]
            for slot in folded.values()
            if slot["org_id"] == org.org_id
        ]

    def _children(org: OrgRow) -> list[OrgRow]:
        return [child for child in orgs if child.parent_id == org.org_id]

    def _desc_contrib(org: OrgRow) -> int:
        total = sum(slot["contributions"] for slot in folded.values() if slot["org_id"] == org.org_id)
        return total + sum(_desc_contrib(child) for child in _children(org))

    def _desc_member_count(org: OrgRow) -> int:
        return len(_direct(org)) + sum(_desc_member_count(child) for child in _children(org))

    def _node(org: OrgRow) -> dict:
        children = _children(org)
        contrib = _desc_contrib(org)
        return {
            "id": str(org.org_id),
            "name": org.name,
            "kind": org.kind,
            "source": org.source,
            "member_count": _desc_member_count(org),
            "contribution_share": (
                round(contrib / total_contributions, 4) if total_contributions > 0 else 0.0
            ),
            "members": _direct(org),
            "teams": [_node(child) for child in children],
        }

    root_orgs = [o for o in orgs if o.parent_id is None]
    unclassified = [
        member_views[slot["contributor_id"]]
        for slot in folded.values()
        if slot["org_id"] is None
    ]

    tier_counts = {tier: sum(1 for t in tiers.values() if t == tier) for tier in TIERS}

    return {
        "summary": {
            "total_contributors": len(folded),
            "total_orgs": len(root_orgs),
            "unclassified_count": len(unclassified),
            "tiers": tier_counts,
            "alerts": [
                {**a, "login": member_views[a["id"]]["login"], "org_id": member_views[a["id"]]["org_id"]}
                for a in alerts
            ],
        },
        "orgs": [_node(o) for o in root_orgs],
        "unclassified": unclassified,
    }