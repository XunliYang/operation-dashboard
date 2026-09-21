/** 看板 A · 仓库 API（对应 api/app/routers/repos.py）。 */
import { request } from '@/core/api/client';
import type {
  Contributor,
  HealthSeries,
  MetricSeries,
  RepoDetail,
  RepoSummary,
} from '@/core/types';

export interface RangeParams {
  from?: string;
  to?: string;
  granularity?: string;
}

function qs(params: RangeParams): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const reposApi = {
  list: () => request<RepoSummary[]>('/dashboard/repos'),
  detail: (id: string) => request<RepoDetail>(`/dashboard/repos/${id}`),
  health: (id: string, range: RangeParams = {}) =>
    request<HealthSeries>(`/dashboard/repos/${id}/health${qs(range)}`),
  metrics: (id: string, metric: string, range: RangeParams = {}) =>
    request<MetricSeries>(`/dashboard/repos/${id}/metrics/${metric}${qs(range)}`),
  contributors: (id: string) => request<Contributor[]>(`/dashboard/repos/${id}/contributors`),
};