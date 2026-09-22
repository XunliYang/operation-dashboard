-- ============================================================================
-- 贡献度指标数据载体（LEOY-47 · 贡献度 S1 阶段）
--
-- 三处变更：
--   1. dim_contributor.email_domain — 邮箱域名（域名非 PII，可明文存），
--      配合 0003 的 email_hash / email_masked 落地「按邮箱后缀区分组织」的数据侧。
--   2. fact_contributor_code_weekly — 代码量周桶（/stats/contributors），
--      写入方 ON CONFLICT (repo_id, week_start, gh_login) DO UPDATE（周桶会随
--      GitHub 重算而变化，必须可覆盖）。
--   3. fact_wiki_revision — wiki 修订历史，append-only（DO NOTHING，与 fact_commit
--      同法，见 collector/collector/db.py 的写入入口）。
--
-- 幂等：全部 IF NOT EXISTS，由既有 runner api/app/db/migrate.py 自动应用。
-- ============================================================================

ALTER TABLE dim_contributor ADD COLUMN IF NOT EXISTS email_domain TEXT;
CREATE INDEX IF NOT EXISTS idx_contributor_email_domain ON dim_contributor (email_domain);

CREATE TABLE IF NOT EXISTS fact_contributor_code_weekly (
    repo_id      BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    author_id    BIGINT REFERENCES dim_contributor(contributor_id),
    gh_login     TEXT,
    week_start   DATE   NOT NULL,
    commits      INT    NOT NULL DEFAULT 0,
    additions    INT    NOT NULL DEFAULT 0,
    deletions    INT    NOT NULL DEFAULT 0,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (repo_id, week_start, gh_login)
);

CREATE TABLE IF NOT EXISTS fact_wiki_revision (
    repo_id           BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    page_slug         TEXT   NOT NULL,
    revision_sha      TEXT   NOT NULL,
    author_id         BIGINT REFERENCES dim_contributor(contributor_id),
    author_email_hash TEXT,
    committed_at      TIMESTAMPTZ NOT NULL,
    message           TEXT,
    PRIMARY KEY (repo_id, page_slug, revision_sha)
);
CREATE INDEX IF NOT EXISTS idx_wiki_rev_author ON fact_wiki_revision (author_id);