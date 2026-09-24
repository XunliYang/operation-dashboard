-- ============================================================================
-- 修复 last_seen_at 采集污染（LEOY-70 · 活跃度分层口径修正 · 方案 A）
--
-- 背景：collector/collector/code_stats.py 此前在写代码量周桶前 upsert 贡献者时，
-- 把 seen_at 传成 now()，而 upsert_contributor 的语义是
-- `last_seen_at = GREATEST(dim_contributor.last_seen_at, EXCLUDED.last_seen_at)`。
-- 两者相加导致：每一轮采集，凡出现在 /stats/contributors（历史全量作者，含早已
-- 停更的人）里的作者，last_seen_at 都被刷成「当前时间」，与真实活动完全无关，
-- 使活跃度分层里「流失」层永远不可能有值（37 人 0 流失、0 贡献却判「活跃」）。
--
-- 本迁移一次性把被推高的 last_seen_at 重算为「各事实表里该作者真实活动时间的
-- 最大值」，之后由已修复的采集代码保证不再回退污染（GREATEST 只增不减，故存量
-- 脏数据必须显式修一次，新代码无法自动回落）。
--
-- 口径取舍（保守优先）：事实表只覆盖回填窗口——fact_commit 自 2026-06-24、
-- fact_pull_request 自 2026-05-19 起；由事实表推出的「最后活动」对更早停更的人
-- 会偏保守（偏早）。用 fact_contributor_code_weekly（commit>0 的周，能覆盖到
-- 2026-03）再补一格。宁可判成偶发/流失，不要判成活跃——这正是本次要修的方向。
--
-- 幂等：UPDATE 只看 last_active（各来源最大值的 GREATEST）是否为 NULL；无任何
-- 活动记录的贡献者（last_active IS NULL）保持原值不动。重复执行结果不变。
-- 由既有 runner api/app/db/migrate.py 按文件名序号自动应用。
-- ============================================================================

WITH real_activity AS (
    SELECT c.contributor_id,
           GREATEST(
               (SELECT max(f.committed_at)      FROM fact_commit f        WHERE f.author_id   = c.contributor_id),
               (SELECT max(p.created_at)        FROM fact_pull_request p  WHERE p.author_id   = c.contributor_id),
               (SELECT max(i.created_at)        FROM fact_issue i         WHERE i.author_id   = c.contributor_id),
               (SELECT max(r.submitted_at)      FROM fact_review r        WHERE r.reviewer_id = c.contributor_id),
               (SELECT max(w.week_start)::timestamptz
                  FROM fact_contributor_code_weekly w
                 WHERE w.author_id = c.contributor_id AND w.commits > 0)
           ) AS last_active
    FROM dim_contributor c
)
UPDATE dim_contributor d
   SET last_seen_at = ra.last_active
  FROM real_activity ra
 WHERE ra.contributor_id = d.contributor_id
   AND ra.last_active IS NOT NULL;