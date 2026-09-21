/** 后端统一响应包装（对应 api/app/core/response.py）。 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  request_id: string;
}

/** 业务成功码。 */
export const CODE_OK = 0;

export interface HealthData {
  status: string;
  service: string;
}

/** 维度下钻到的单个原始指标（不可黑箱：value 原始值 + score 归一化分）。 */
export interface DimensionIndicator {
  key: string;
  label: string;
  direction: 'higher_better' | 'lower_better';
  value: number;
  score: number;
}

/** 一个健康维度。 */
export interface HealthDimension {
  key: string;
  label: string;
  weight: number;
  score: number;
  indicators: DimensionIndicator[];
}

/** 综合健康分（0–100）+ 五维明细。 */
export interface HealthScore {
  score: number;
  dimensions: HealthDimension[];
}

/** 被监控仓库摘要（列表项）。 */
export interface RepoSummary {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  health_score: number;
  stars: number;
  forks: number;
  open_issues: number;
  open_prs: number;
}

/** 仓库详情的关键指标卡。 */
export interface KeyMetrics {
  commits_30d: number;
  active_contributors_30d: number;
  prs_merged_30d: number;
  issues_closed_30d: number;
  stars: number;
  forks: number;
  open_issues: number;
  open_prs: number;
}

/** 仓库详情。 */
export interface RepoDetail {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  health: HealthScore;
  key_metrics: KeyMetrics;
}

/** 健康分时序点。 */
export interface HealthSeriesPoint {
  date: string;
  score: number;
  dimensions: Array<{ key: string; score: number }>;
}

/** 健康分时序。 */
export interface HealthSeries {
  repo_id: string;
  granularity: string;
  window_days: number;
  series: HealthSeriesPoint[];
  latest: HealthScore;
}

/** 单指标时序点。 */
export interface MetricPoint {
  date: string;
  value: number;
}

/** 单指标时序。 */
export interface MetricSeries {
  metric: string;
  series: MetricPoint[];
}

/** 贡献者排行项。 */
export interface Contributor {
  login: string;
  commits: number;
  prs: number;
  reviews: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface PersonSummary {
  login: string;
  displayName: string;
  contributions: number;
}

export interface SentimentSummary {
  /** ISO 日期 */
  date: string;
  /** -1（负面）~ 1（正面） */
  score: number;
  mentions: number;
}

export type RouteKey = 'overview' | 'repos' | 'people' | 'sentiment' | 'settings';
