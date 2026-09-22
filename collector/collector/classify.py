"""组织分类任务：读 YAML mapping + 库里的 `dim_contributor`，复用分类器落库。

**复用优先级的 canonical 实现**（不要在这里重写）：
单一来源的优先级归并（`manual_yaml` > `api` > `email_domain` > `inferred`）由
`app.services.org_classifier.classify()` 保证。这里只做数据搬运：读
`dim_contributor` → `classify()` → 幂等写 `dim_org`（按 `key` upsert）与
`bridge_contributor_org`（`valid_to IS NULL` 为当前行）。

触发频率：并入 `collect_github_activity` 的收尾步骤——每轮定时兜底（默认 600s）
在采集后跑一次；分类幂等、成本与贡献者数量成正比，无需独立调度周期。

分类来源为 `email_domain` 时 `confidence = 0.6`（与 api/services/org_classifier.py
的 `CONFIDENCE[SOURCE_EMAIL_DOMAIN]` 一致），由 classify() 返回，无需在此硬编码。
"""

from __future__ import annotations

from app.services.org_classifier import (
    SOURCE_INFERRED,
    SOURCE_MANUAL_YAML,
    UNCLASSIFIED_KEY,
    UNCLASSIFIED_NAME,
    classify,
    load_org_mapping,
)
from loguru import logger

import collector.db as db


def classify_contributors(conn, config_dir: str) -> int:
    """把全部贡献者分类并写入组织维度，返回处理的贡献者数。"""
    mapping = load_org_mapping(config_dir)

    # 1) 确保组织维度存在：YAML 里声明的组织 + 未归类桶（_unclassified）。
    org_ids: dict[str, int] = {}
    for key, spec in mapping.orgs.items():
        org_ids[key] = db.upsert_org(conn, key=key, name=spec.display, source=SOURCE_MANUAL_YAML)
    org_ids[UNCLASSIFIED_KEY] = db.upsert_org(
        conn, key=UNCLASSIFIED_KEY, name=UNCLASSIFIED_NAME, source=SOURCE_INFERRED
    )

    # 2) 逐贡献者分类并写桥表。
    count = 0
    for contributor_id, login, domain, company_raw in db.list_classifiable_contributors(conn):
        # dim_contributor 只存 email_domain（明文邮箱不落库），据此合成一个可喂给
        # classify() 的 email——classify 内部用 email_domain() 提取域名即可命中。
        email = f"x@{domain}" if domain else None
        result = classify(login=login, company_raw=company_raw, email=email, mapping=mapping)
        org_id = org_ids.get(result.org_key)
        if org_id is None:  # 防御：mapping 之外的新 key（正常不会发生）
            org_id = db.upsert_org(
                conn, key=result.org_key, name=result.org_key, source=result.source
            )
            org_ids[result.org_key] = org_id
        db.upsert_contributor_org(
            conn,
            contributor_id=contributor_id,
            org_id=org_id,
            source=result.source,
            confidence=result.confidence,
        )
        count += 1

    logger.info("classified {} contributors into {} orgs", count, len(org_ids))
    return count