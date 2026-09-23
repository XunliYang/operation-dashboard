/** 贡献度插件 API 门面：re-export 核心客户端，并声明五口径常量与展示辅助。 */
import type { ContributionMetricKey, ContributionMetrics } from '@/core/types';

export {
  CONTRIBUTION_METRIC_KEYS as METRIC_KEYS,
  contributionsApi,
  formatNumber,
} from '@/core/api/contributions';
export type {
  ContributionGroup,
  ContributionMetricKey,
  ContributionMetrics,
  ContributorDetail,
  ContributionsSummary,
  Leaderboard,
  MetricMeta,
  RankedContributor,
} from '@/core/types';

/** 取某口径的单值（code 归一为增删总和，与后端 metric_value 一致）。 */
export function metricValue(
  metrics: ContributionMetrics,
  metric: ContributionMetricKey,
): number {
  return metric === 'code' ? metrics.code_total : metrics[metric];
}

/** 维度 Tab 与时间窗预设。 */
export type Dimension = 'org' | 'repo' | 'project';
export type RangePreset = '30d' | '90d' | 'custom';

/** 页面筛选状态（时间窗 from/to 为 YYYY-MM-DD）。 */
export interface ContributionsFilterState {
  dimension: Dimension;
  metric: ContributionMetricKey;
  preset: RangePreset;
  from: string;
  to: string;
  scope: string | null;
}

/** 组织下拉选项（来自 summary group_by=org 的 groups）。 */
export interface OrgOption {
  key: string;
  name: string;
}

/** 仓库下拉选项（来自 reposApi.list()）。 */
export interface RepoOption {
  id: string;
  full_name: string;
}

/** 计算「最近 N 天」窗口的 from/to（含今天，后端 to 记到当日 23:59:59）。 */
export function recentWindow(days: number): { from: string; to: string } {
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: toISODate(from), to: toISODate(to) };
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 默认时间窗 = 最近 90 天（需求方 2026-09-22 拍板）。 */
export function defaultFilter(): ContributionsFilterState {
  const { from, to } = recentWindow(90);
  return {
    dimension: 'org',
    metric: 'commits',
    preset: '90d',
    from,
    to,
    scope: null,
  };
}