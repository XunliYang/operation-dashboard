-- ============================================================================
-- 人员组织分类看板（LEOY-6 · Phase 2）数据模型
--
-- 三张新表 + 一处 dim_contributor 扩展：
--   dim_org                — 组织/团队树（Org → Team），`key` 为幂等自然键
--   bridge_contributor_org — 人 ↔ 组织 多对多，带 role/confidence/source，
--                             valid_from/valid_to 支持历史回溯（当前行 valid_to IS NULL）
--   identity_merge         — 多身份归并，status 状态机 pending|confirmed|rejected
--
-- 隐私约定：邮箱不落明文。dim_contributor.email_hash 存 sha256(salt + lower(email))，
-- email_masked 存脱敏展示形（如 z***@huawei.com）；两者均非明文，原始邮箱只在采集/分类
-- 的瞬态内存中出现，绝不持久化。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 组织 / 团队树
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_org (
    org_id     BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'org',  -- org | team
    key        TEXT NOT NULL UNIQUE,         -- 幂等自然键，如 openan / openan:core
    source     TEXT,                          -- manual_yaml | api | email_domain | inferred
    parent_id  BIGINT REFERENCES dim_org(org_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_parent ON dim_org (parent_id);

-- ---------------------------------------------------------------------------
-- 人 ↔ 组织 桥接（含历史回溯）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_contributor_org (
    contributor_id BIGINT NOT NULL REFERENCES dim_contributor(contributor_id),
    org_id         BIGINT NOT NULL REFERENCES dim_org(org_id),
    role           TEXT,
    confidence     NUMERIC(4,3) NOT NULL DEFAULT 0,
    source         TEXT NOT NULL,
    valid_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to       TIMESTAMPTZ,               -- NULL = 当前有效
    PRIMARY KEY (contributor_id, org_id, source, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_bridge_current
    ON bridge_contributor_org (org_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_bridge_contrib
    ON bridge_contributor_org (contributor_id);

-- ---------------------------------------------------------------------------
-- 身份归并（多 email / login 聚类后的人工确认）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_merge (
    merge_id     BIGSERIAL PRIMARY KEY,
    canonical_id BIGINT NOT NULL REFERENCES dim_contributor(contributor_id),
    merged_id    BIGINT NOT NULL REFERENCES dim_contributor(contributor_id),
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | rejected
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    UNIQUE (canonical_id, merged_id)
);

-- ---------------------------------------------------------------------------
-- dim_contributor 扩展：脱敏邮箱（非明文）
-- ---------------------------------------------------------------------------
ALTER TABLE dim_contributor ADD COLUMN IF NOT EXISTS email_masked TEXT;
