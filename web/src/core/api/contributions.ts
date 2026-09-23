/** 贡献度聚合 API（对应 api/app/routers/contributions.py 与 people.py 的扩展）。 */
import { request } from '@/core/api/client';
import type {
  ContributionMetricKey,
  ContributorDetail,
  ContributionsSummary,
  Leaderboard,
} from '@/core/types';

export interface ContributionsRange {
  from?: string;
  to?: string;
}

export interface SummaryParams extends ContributionsRange {
  groupBy: 'org' | 'repo';
  metric: ContributionMetricKey;
  /** 组织键（成员过滤，可选）。 */
  org?: string;
  /** repo_id 或 owner/name（可选）。 */
  repo?: string;
}

export interface LeaderboardParams extends ContributionsRange {
  dimension: 'org' | 'repo' | 'project';
  /** org 键或 repo_id（dimension=project 时省略）。 */
  scope?: string;
  metric: ContributionMetricKey;
  limit?: number;
  offset?: number;
}

/** 五口径枚举（与后端 `METRICS` 顺序一致；core 层常量，供多插件与共享层复用）。 */
export const CONTRIBUTION_METRIC_KEYS: ReadonlyArray<ContributionMetricKey> = [
  'prs',
  'commits',
  'code',
  'issues',
  'wiki',
];

/** 千分位格式化（代码量可到百万行）。 */
export function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 与 `core/api/repos.ts` 的 qs 同法：过滤 undefined / 空串。 */
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const contributionsApi = {
  summary: (params: SummaryParams) =>
    request<ContributionsSummary>(
      `/dashboard/contributions/summary${qs({
        group_by: params.groupBy,
        metric: params.metric,
        org: params.org,
        repo: params.repo,
        from: params.from,
        to: params.to,
      })}`,
    ),
  leaderboard: (params: LeaderboardParams) =>
    request<Leaderboard>(
      `/dashboard/contributions/leaderboard${qs({
        dimension: params.dimension,
        scope: params.scope,
        metric: params.metric,
        from: params.from,
        to: params.to,
        limit: params.limit,
        offset: params.offset,
      })}`,
    ),
  contributor: (id: string) => request<ContributorDetail>(`/dashboard/contributors/${id}`),
};