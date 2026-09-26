"""组织分类：域名→组织映射（含 GitHub 占位邮箱→external）+ classify_contributors 落库。"""

from __future__ import annotations

from pathlib import Path

from app.services.org_classifier import SOURCE_EMAIL_DOMAIN, classify, load_org_mapping

import collector.classify as cl

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"


def test_real_mapping_domain_to_org():
    mapping = load_org_mapping(str(CONFIG_DIR))
    assert classify(login="a", email="x@huawei.com", mapping=mapping).org_key == "huawei"
    # h-partners.com 并入 huawei，不再有 huawei-partner 组织键（需求方 2026-09-22 拍板）；
    # 展示名由「华为系」改为「华为」（需求方 2026-09-23 拍板），归并关系不变。
    assert classify(login="a", email="x@h-partners.com", mapping=mapping).org_key == "huawei"
    assert classify(login="a", email="x@zte.com.cn", mapping=mapping).org_key == "zte"
    assert classify(login="a", email="x@gdcattsoft.com", mapping=mapping).org_key == "gdcattsoft"
    # GitHub 占位邮箱 → external，不得误判成某个公司
    assert classify(login="a", email="x@users.noreply.github.com", mapping=mapping).org_key == "external"
    assert classify(login="a", email="noreply@github.com", mapping=mapping).org_key == "external"


def test_no_huawei_partner_org_key():
    mapping = load_org_mapping(str(CONFIG_DIR))
    assert "huawei-partner" not in mapping.orgs
    assert mapping.orgs["huawei"].display == "华为"


def test_hpartners_maps_to_huawei_key_with_huawei_display():
    """h-partners.com 归 huawei 键，且该键的展示名是「华为」——两者绑在同一条断言里防回归。"""
    mapping = load_org_mapping(str(CONFIG_DIR))
    result = classify(login="a", email="x@h-partners.com", mapping=mapping)
    assert result.org_key == "huawei"
    assert mapping.orgs["huawei"].display == "华为"
    assert "huawei-partner" not in mapping.orgs


def test_email_domain_source_is_06():
    mapping = load_org_mapping(str(CONFIG_DIR))
    result = classify(login="a", email="x@huawei.com", mapping=mapping)
    assert result.source == SOURCE_EMAIL_DOMAIN
    assert abs(result.confidence - 0.6) < 1e-9


def test_unmatched_domain_goes_unclassified():
    mapping = load_org_mapping(str(CONFIG_DIR))
    assert classify(login="ghost", mapping=mapping).org_key == "_unclassified"
    assert classify(login="a", email="x@somewhere-else.io", mapping=mapping).org_key == "_unclassified"


def test_classify_contributors_writes_orgs_and_bridges(monkeypatch):
    monkeypatch.setattr(
        cl.db,
        "list_classifiable_contributors",
        lambda conn: [
            (1, "alice", "huawei.com", None),
            (2, "bob", "gmail.com", None),
            (3, "carol", None, None),
        ],
    )

    org_ids: dict[str, int] = {}
    _next = iter([11, 12, 13, 14, 15, 16, 17, 18])

    def fake_upsert_org(conn, *, key, name, source):
        if key not in org_ids:
            org_ids[key] = next(_next)
        return org_ids[key]

    bridges: list[dict] = []
    monkeypatch.setattr(cl.db, "upsert_org", fake_upsert_org)
    monkeypatch.setattr(cl.db, "upsert_contributor_org", lambda conn, **k: bridges.append(k))

    n = cl.classify_contributors(object(), str(CONFIG_DIR))
    assert n == 3

    by_cid = {b["contributor_id"]: b for b in bridges}
    # alice → huawei, bob → external（gmail.com）, carol → _unclassified
    assert by_cid[1]["org_id"] == org_ids["huawei"]
    assert by_cid[2]["org_id"] == org_ids["external"]
    assert by_cid[3]["org_id"] == org_ids["_unclassified"]
    assert by_cid[1]["source"] == SOURCE_EMAIL_DOMAIN
    assert by_cid[2]["source"] == SOURCE_EMAIL_DOMAIN
    assert by_cid[3]["source"] == "inferred"
    assert abs(by_cid[1]["confidence"] - 0.6) < 1e-9
    assert abs(by_cid[3]["confidence"] - 0.0) < 1e-9
