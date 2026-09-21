"""组织分类器（LEOY-6 · Phase 2 §5.2）。

把一名贡献者归并到组织，按优先级选取来源，绝不出现低优先级覆盖高优先级：

  1. `manual_yaml`   config/org_mapping.yaml 人工映射（login → org），confidence 1.0；
  2. `api`           GitHub API 派生（profile company / 组织成员关系 / CODEOWNERS / teams）；
  3. `email_domain`  邮箱域名推断，confidence ≈0.6；
  4. `inferred`      无法判定 → 待归类，confidence 0（在看板显式呈现，不静默丢弃）。

同时提供邮箱隐私工具：明文邮箱只在采集 / 分类的瞬态内存中出现，落库前转为
`sha256(salt + lower(email))`（`hash_email`）与脱敏展示形（`mask_email`），二者均非明文。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# ---- 来源与置信度 ----

SOURCE_MANUAL_YAML = "manual_yaml"
SOURCE_API = "api"
SOURCE_EMAIL_DOMAIN = "email_domain"
SOURCE_INFERRED = "inferred"

# 各来源默认置信度（用于写入 bridge_contributor_org.confidence）。
# email_domain 按设计取 ≈0.6；api 介于人工与域名推断之间，取 0.8。
CONFIDENCE: dict[str, float] = {
    SOURCE_MANUAL_YAML: 1.0,
    SOURCE_API: 0.8,
    SOURCE_EMAIL_DOMAIN: 0.6,
    SOURCE_INFERRED: 0.0,
}

UNCLASSIFIED_KEY = "_unclassified"
UNCLASSIFIED_NAME = "待归类"


@dataclass(frozen=True)
class OrgSpec:
    """org_mapping.yaml 中的单个组织 / 团队。

    `companies` / `email_domains` 均以小写存储；`members` 为 GitHub login 列表。
    """

    key: str
    display: str
    members: tuple[str, ...] = ()
    companies: tuple[str, ...] = ()
    email_domains: tuple[str, ...] = ()
    repos: tuple[str, ...] = ()
    parent: str | None = None


@dataclass
class OrgMapping:
    orgs: dict[str, OrgSpec]
    default_org: str
    unclassified_key: str = UNCLASSIFIED_KEY


@dataclass(frozen=True)
class Classification:
    """一次分类结果（单一来源，优先级已保证）。"""

    org_key: str
    source: str
    confidence: float

    @property
    def is_unclassified(self) -> bool:
        return self.org_key == UNCLASSIFIED_KEY


# ---------------------------------------------------------------------------
# 配置加载
# ---------------------------------------------------------------------------


def load_org_mapping(config_dir: str | Path) -> OrgMapping:
    """加载 config/org_mapping.yaml，归一化 members/companies/email_domains。"""
    path = Path(config_dir) / "org_mapping.yaml"
    raw: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    raw_orgs = raw.get("orgs") or {}

    orgs: dict[str, OrgSpec] = {}
    for key, spec in raw_orgs.items():
        orgs[key] = OrgSpec(
            key=key,
            display=str(spec.get("display") or key),
            members=tuple(str(m) for m in (spec.get("members") or [])),
            companies=tuple(str(c).lower() for c in (spec.get("companies") or [])),
            email_domains=tuple(str(d).lower() for d in (spec.get("email_domains") or [])),
            repos=tuple(str(r) for r in (spec.get("repos") or [])),
            parent=spec.get("parent"),
        )

    return OrgMapping(orgs=orgs, default_org=str(raw.get("default_org") or "openan"))


def org_ids_for_contributor(mapping: OrgMapping, login: str) -> list[str]:
    """采集侧辅助：login 命中的组织 key 列表（用于 api 成员关系聚类的兜底）。"""
    lowered = (login or "").strip().lower()
    if not lowered:
        return []
    return [spec.key for spec in mapping.orgs.values() if lowered in {m.lower() for m in spec.members}]


# ---------------------------------------------------------------------------
# 分类核心（优先级归并）
# ---------------------------------------------------------------------------


def _company_matches(company_raw: str, spec_company: str) -> bool:
    """公司名匹配：归一空白后小写，双向子串命中（兼容 'Huawei' ↔ 'Huawei Technologies'）。"""
    c = " ".join((company_raw or "").lower().split())
    s = " ".join(spec_company.lower().split())
    return bool(s) and (s in c or c in s)


def classify(
    *,
    login: str | None,
    company_raw: str | None = None,
    email: str | None = None,
    memberships: list[str] | tuple[str, ...] | None = None,
    mapping: OrgMapping,
) -> Classification:
    """按优先级把一名贡献者归并到组织，返回单一 `Classification`。

    同一人可能同时命中多源（例如既有 login 映射、邮箱域名又命中另一组织），
    此时只取最高优先级来源，绝不出现低优先级覆盖高优先级。
    """
    login_l = (login or "").strip().lower()
    member_keys = {m.lower() for m in memberships or ()}

    # 1) 人工映射（最权威）
    if login_l:
        for spec in mapping.orgs.values():
            if login_l in {m.lower() for m in spec.members}:
                return Classification(spec.key, SOURCE_MANUAL_YAML, CONFIDENCE[SOURCE_MANUAL_YAML])

    # 2) GitHub API：profile company 或组织成员关系
    for spec in mapping.orgs.values():
        if company_raw and any(_company_matches(company_raw, c) for c in spec.companies):
            return Classification(spec.key, SOURCE_API, CONFIDENCE[SOURCE_API])
    for spec in mapping.orgs.values():
        if member_keys & ({spec.key.lower(), spec.display.lower()}):
            return Classification(spec.key, SOURCE_API, CONFIDENCE[SOURCE_API])

    # 3) 邮箱域名推断
    domain = email_domain(email)
    if domain:
        for spec in mapping.orgs.values():
            if domain in spec.email_domains:
                return Classification(spec.key, SOURCE_EMAIL_DOMAIN, CONFIDENCE[SOURCE_EMAIL_DOMAIN])

    # 4) 无法判定 → 待归类（显式呈现，不静默丢弃）
    return Classification(UNCLASSIFIED_KEY, SOURCE_INFERRED, CONFIDENCE[SOURCE_INFERRED])


# ---------------------------------------------------------------------------
# 邮箱隐私工具
# ---------------------------------------------------------------------------


def email_domain(email: str | None) -> str | None:
    """提取邮箱域名（小写）；非邮箱格式返回 None。"""
    if not email:
        return None
    local, _, domain = str(email).strip().rpartition("@")
    domain = domain.strip()
    if not local or not domain or "." not in domain:
        return None
    return domain.lower()


def hash_email(email: str, salt: str) -> str:
    """`sha256(salt + lower(email))` —— dim_contributor.email_hash 的规范存储。"""
    raw = f"{salt}{str(email).strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    """脱敏展示形：仅保留本地部分首字符 + 完整域名（如 `z***@huawei.com`）。"""
    local, _, domain = str(email).partition("@")
    if not domain:
        return "***"
    initial = local[:1].lower() if local else "*"
    return f"{initial}***@{domain.lower()}"