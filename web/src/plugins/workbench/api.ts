/** 工作台 API（对应 api/app/routers/workbench.py · GET /dashboard/workbench）。 */
import { request } from '@/core/api/client';

export interface WorkbenchListItem {
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  to: string;
  days_since_commit?: number | null;
  first_score?: number;
  last_score?: number;
  drop?: number;
  pr_number?: number;
  title?: string | null;
  days_waiting?: number;
  merged_at?: string | null;
  median_hours?: number;
}

export interface WorkbenchThresholds {
  window_days: number;
  review_backlog_days: number;
  slow_response_hours: number;
  health_drop_top_n: number;
  health_drop_dimension: string;
  list_limit: number;
}

export interface WorkbenchData {
  org: string | null;
  window_days: number;
  thresholds: WorkbenchThresholds;
  stalled_repos: number;
  health_drops: WorkbenchListItem[];
  review_backlog: number;
  unlinked_prs: number;
  slow_issue_response: number;
  unclassified_people: number | null;
  /** Phase 3 舆情接入后追加；本 issue 预留字段位，恒为 null。 */
  sentiment_spike: number | null;
  lists: {
    stalled_repos: WorkbenchListItem[];
    health_drops: WorkbenchListItem[];
    recent_releases: WorkbenchListItem[];
    review_backlog: WorkbenchListItem[];
    unlinked_prs: WorkbenchListItem[];
    slow_issue_response: WorkbenchListItem[];
  };
}

export interface WorkbenchParams {
  org?: string;
  window?: string;
}

export const workbenchApi = {
  overview: (params: WorkbenchParams = {}) => {
    const search = new URLSearchParams();
    if (params.org) search.set('org', params.org);
    if (params.window) search.set('window', params.window);
    const qs = search.toString();
    return request<WorkbenchData>(`/dashboard/workbench${qs ? `?${qs}` : ''}`);
  },
};