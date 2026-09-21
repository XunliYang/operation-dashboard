-- ============================================================================
-- P1-2 修复配套：fact_pull_request 增加 updated_at，作为 pulls 增量早停游标。
--
-- 背景：pulls 列表用 `sort=updated&direction=desc` 做增量早停，需要一个持久
-- 游标记录「上次已摄入 PR 的最大更新时间」。镜像 `fact_commit` 的
-- `collector._commits_cursor`（MAX(committed_at)）模式。
--
-- 幂等：ADD COLUMN IF NOT EXISTS。既有行 updated_at 为 NULL，由后续采集补齐；
-- MAX(updated_at) 忽略 NULL，表空或仅有旧行时游标为 NULL 会触发一次全量回填。
-- ============================================================================

ALTER TABLE fact_pull_request ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;