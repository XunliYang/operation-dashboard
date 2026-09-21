-- ============================================================================
-- 运营看板 · GitHub 健康度数据模型（架构设计 v2 §4.2）
--
-- Phase 1 全量 DDL。全部语句幂等（IF NOT EXISTS / 分区冲突由本文件保证），
-- 可重复执行。canonical 版本在 api/migrations/；collector/schema.sql 是其镜像。
--
-- 分区约定：fact_commit / fact_pull_request / fact_issue / fact_review /
-- fact_workflow_run 按月 PARTITION BY RANGE。先建 DEFAULT 分区兜底，
-- 再为 2025-01 ~ 2028-01 预建月分区；更远月份由 DBA 脚本按需扩展。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 维度表
-- ---------------------------------------------------------------------------

-- 被监控的 GitHub 仓库
CREATE TABLE IF NOT EXISTS dim_repo (
    repo_id        BIGSERIAL PRIMARY KEY,
    gh_id          BIGINT UNIQUE NOT NULL,
    owner          TEXT   NOT NULL,
    name           TEXT   NOT NULL,
    default_branch TEXT   NOT NULL DEFAULT 'main',
    archived       BOOLEAN NOT NULL DEFAULT false,
    tracked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    collect_config JSONB  NOT NULL DEFAULT '{}',
    UNIQUE (owner, name)
);

-- 贡献者（自然人粒度，跨仓库唯一）
CREATE TABLE IF NOT EXISTS dim_contributor (
    contributor_id BIGSERIAL PRIMARY KEY,
    gh_login       TEXT UNIQUE,
    gh_id          BIGINT UNIQUE,
    display_name   TEXT,
    email_hash     TEXT,
    company_raw    TEXT,
    first_seen_at  TIMESTAMPTZ,
    last_seen_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_contrib_email_hash ON dim_contributor (email_hash);

-- ---------------------------------------------------------------------------
-- 事实表（按月分区）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fact_commit (
    repo_id       BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    sha           TEXT   NOT NULL,
    author_id     BIGINT REFERENCES dim_contributor(contributor_id),
    committed_at  TIMESTAMPTZ NOT NULL,
    branch        TEXT,
    additions     INT,
    deletions     INT,
    files_changed INT,
    is_merge      BOOLEAN DEFAULT false,
    PRIMARY KEY (repo_id, sha, committed_at)
) PARTITION BY RANGE (committed_at);

CREATE TABLE IF NOT EXISTS fact_pull_request (
    repo_id         BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    pr_number       INT    NOT NULL,
    author_id       BIGINT REFERENCES dim_contributor(contributor_id),
    state           TEXT   NOT NULL,
    title           TEXT,
    created_at      TIMESTAMPTZ NOT NULL,
    first_review_at TIMESTAMPTZ,
    merged_at       TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    review_count    INT DEFAULT 0,
    additions       INT,
    deletions       INT,
    PRIMARY KEY (repo_id, pr_number, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS fact_issue (
    repo_id         BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    issue_number    INT    NOT NULL,
    author_id       BIGINT REFERENCES dim_contributor(contributor_id),
    state           TEXT   NOT NULL,
    title           TEXT,
    is_pull_request BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL,
    closed_at       TIMESTAMPTZ,
    labels          JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (repo_id, issue_number, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS fact_review (
    repo_id      BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    pr_number    INT    NOT NULL,
    reviewer_id  BIGINT REFERENCES dim_contributor(contributor_id),
    submitted_at TIMESTAMPTZ NOT NULL,
    state        TEXT,
    PRIMARY KEY (repo_id, pr_number, reviewer_id, submitted_at)
) PARTITION BY RANGE (submitted_at);

CREATE TABLE IF NOT EXISTS fact_workflow_run (
    repo_id       BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    run_id        BIGINT NOT NULL,
    workflow_name TEXT,
    conclusion    TEXT,
    status        TEXT,
    started_at    TIMESTAMPTZ NOT NULL,
    completed_at  TIMESTAMPTZ,
    duration_s    INT,
    PRIMARY KEY (repo_id, run_id, started_at)
) PARTITION BY RANGE (started_at);

-- ---------------------------------------------------------------------------
-- 日粒度快照 / 聚合表（非分区，永久保留）
-- ---------------------------------------------------------------------------

-- 仓库日快照：stars / forks / open_issues / open_prs 等非事件类指标
CREATE TABLE IF NOT EXISTS fact_repo_metric_daily (
    repo_id     BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    date        DATE   NOT NULL,
    stars       INT NOT NULL DEFAULT 0,
    forks       INT NOT NULL DEFAULT 0,
    watchers    INT NOT NULL DEFAULT 0,
    open_issues INT NOT NULL DEFAULT 0,
    open_prs    INT NOT NULL DEFAULT 0,
    PRIMARY KEY (repo_id, date)
);

-- 健康度日评分：dimension ∈ {activity, collaboration, quality, community,
-- sustainability, composite}；raw 保存原始指标与归一化明细（不可黑箱）。
CREATE TABLE IF NOT EXISTS agg_health_score_daily (
    repo_id   BIGINT NOT NULL REFERENCES dim_repo(repo_id),
    date      DATE   NOT NULL,
    dimension TEXT   NOT NULL,
    score     NUMERIC(5,2) NOT NULL,
    raw       JSONB  NOT NULL DEFAULT '{}',
    PRIMARY KEY (repo_id, date, dimension)
);

-- ---------------------------------------------------------------------------
-- 采集运行记录（幂等与可观测基础）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collect_run (
    run_id               BIGSERIAL PRIMARY KEY,
    job                  TEXT NOT NULL,
    repo_id              BIGINT REFERENCES dim_repo(repo_id),
    cursor               TEXT,
    status               TEXT NOT NULL,  -- queued|running|success|failed
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at          TIMESTAMPTZ,
    rate_limit_remaining INT,
    error                TEXT
);
CREATE INDEX IF NOT EXISTS idx_collect_run_job_started ON collect_run (job, started_at DESC);

-- ---------------------------------------------------------------------------
-- 分区：DEFAULT 兜底 + 2025-01 ~ 2028-01 月分区
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fact_commit_default       PARTITION OF fact_commit       DEFAULT;
CREATE TABLE IF NOT EXISTS fact_pull_request_default PARTITION OF fact_pull_request DEFAULT;
CREATE TABLE IF NOT EXISTS fact_issue_default        PARTITION OF fact_issue        DEFAULT;
CREATE TABLE IF NOT EXISTS fact_review_default       PARTITION OF fact_review       DEFAULT;
CREATE TABLE IF NOT EXISTS fact_workflow_run_default PARTITION OF fact_workflow_run DEFAULT;

DO $$
DECLARE
    d  date;
    lo date;
    hi date;
BEGIN
    FOR d IN SELECT generate_series('2025-01-01'::date, '2027-12-01'::date, interval '1 month') LOOP
        lo := date_trunc('month', d)::date;
        hi := (date_trunc('month', d) + interval '1 month')::date;
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS fact_commit_%s PARTITION OF fact_commit FOR VALUES FROM (%L) TO (%L)',
            to_char(lo, 'YYYYMM'), lo, hi);
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS fact_pull_request_%s PARTITION OF fact_pull_request FOR VALUES FROM (%L) TO (%L)',
            to_char(lo, 'YYYYMM'), lo, hi);
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS fact_issue_%s PARTITION OF fact_issue FOR VALUES FROM (%L) TO (%L)',
            to_char(lo, 'YYYYMM'), lo, hi);
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS fact_review_%s PARTITION OF fact_review FOR VALUES FROM (%L) TO (%L)',
            to_char(lo, 'YYYYMM'), lo, hi);
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS fact_workflow_run_%s PARTITION OF fact_workflow_run FOR VALUES FROM (%L) TO (%L)',
            to_char(lo, 'YYYYMM'), lo, hi);
    END LOOP;
END $$;
