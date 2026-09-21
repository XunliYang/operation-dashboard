"""组织分类器：归并优先级 / confidence / 邮箱哈希与脱敏（LEOY-6 验收 1·2·3）。"""

import hashlib
from pathlib import Path

from app.services.org_classifier import (
    SOURCE_API,
    SOURCE_EMAIL_DOMAIN,
    SOURCE_INFERRED,
    SOURCE_MANUAL_YAML,
    UNCLASSIFIED_KEY,
    OrgMapping,
    OrgSpec,
    classify,
    email_domain,
    hash_email,
    load_org_mapping,
    mask_email,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def _mapping() -> OrgMapping:
    return OrgMapping(
        orgs={
            "openan": OrgSpec(key="openan", display="OpenAN"),
            "platform": OrgSpec(key="platform", display="平台组", members=("XunliYang",)),
            "huawei": OrgSpec(
                key="huawei", display="Huawei",
                companies=("Huawei",),
                email_domains=("huawei.com",),
            ),
            "lf": OrgSpec(
                key="linuxfoundation", display="The Linux Foundation",
                email_domains=("linuxfoundation.org",),
            ),
        },
        default_org="openan",
    )


# ---------------------------------------------------------------------------
# 验收 1：来源与 confidence
# ---------------------------------------------------------------------------


def test_manual_yaml_hit_is_confidence_1_and_source_manual():
    result = classify(login="XunliYang", email="x@huawei.com", mapping=_mapping())
    assert result.org_key == "platform"
    assert result.source == SOURCE_MANUAL_YAML
    assert result.confidence == 1.0


def test_email_domain_only_is_about_06_and_source_email_domain():
    result = classify(login="zhang", email="ZhangWei@HUAWEI.com", mapping=_mapping())
    assert result.org_key == "huawei"
    assert result.source == SOURCE_EMAIL_DOMAIN
    assert abs(result.confidence - 0.6) < 1e-9


def test_company_match_is_source_api():
    result = classify(
        login="someone", company_raw="Huawei Technologies Co., Ltd.", mapping=_mapping()
    )
    assert result.org_key == "huawei"
    assert result.source == SOURCE_API
    assert result.confidence == 0.8


def test_org_membership_is_source_api():
    result = classify(login="someone", memberships=["OpenAN"], mapping=_mapping())
    assert result.org_key == "openan"
    assert result.source == SOURCE_API


def test_unclassifiable_goes_to_pending_bucket():
    result = classify(login="ghost", mapping=_mapping())
    assert result.org_key == UNCLASSIFIED_KEY
    assert result.source == SOURCE_INFERRED
    assert result.confidence == 0.0
    assert result.is_unclassified


# ---------------------------------------------------------------------------
# 验收 2：优先级（低优先级不覆盖高优先级）
# ---------------------------------------------------------------------------


def test_priority_manual_yaml_beats_api_and_email():
    # 同时命中 manual_yaml（login → platform）、api（company → huawei）、
    # email_domain（email → lf），结果必须取 manual_yaml。
    result = classify(
        login="XunliYang",
        company_raw="Huawei",
        email="x@linuxfoundation.org",
        mapping=_mapping(),
    )
    assert result.source == SOURCE_MANUAL_YAML
    assert result.org_key == "platform"


def test_priority_api_beats_email_domain():
    result = classify(
        login="someone",
        company_raw="Huawei",
        email="x@linuxfoundation.org",
        mapping=_mapping(),
    )
    assert result.source == SOURCE_API
    assert result.org_key == "huawei"


def test_priority_email_domain_is_last_resort_before_inferred():
    result = classify(login="someone", email="x@huawei.com", mapping=_mapping())
    assert result.source == SOURCE_EMAIL_DOMAIN
    assert result.org_key == "huawei"


# ---------------------------------------------------------------------------
# 验收 3：邮箱不落明文 + 默认脱敏
# ---------------------------------------------------------------------------


def test_hash_email_is_salted_sha256_of_lowercased_email():
    assert hash_email("Zhang@Huawei.com", "my-salt") == hashlib.sha256(
        b"my-saltzhang@huawei.com"
    ).hexdigest()


def test_hash_email_never_returns_plaintext():
    email = "ZhangWei@Huawei.com"
    digest = hash_email(email, "my-salt")
    assert email not in digest
    assert "huawei" not in digest
    # 不同盐产生不同哈希（盐不可事后更改）
    assert hash_email(email, "other-salt") != digest


def test_mask_email_form():
    assert mask_email("ZhangWei@Huawei.com") == "z***@huawei.com"
    assert mask_email("alice@linuxfoundation.org") == "a***@linuxfoundation.org"
    assert mask_email("no-at-sign") == "***"


def test_email_domain_extraction():
    assert email_domain("Zhang@Huawei.com") == "huawei.com"
    assert email_domain("  X@LinuxFoundation.org ") == "linuxfoundation.org"
    assert email_domain("invalid") is None
    assert email_domain(None) is None


# ---------------------------------------------------------------------------
# 真实配置可解析
# ---------------------------------------------------------------------------


def test_load_real_org_mapping():
    mapping = load_org_mapping(REPO_ROOT / "config")
    assert mapping.default_org == "openan"
    assert "platform" in mapping.orgs
    assert "XunliYang" in mapping.orgs["platform"].members