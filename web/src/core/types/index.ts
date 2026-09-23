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

/** 贡献度五口径键（对应 `api/app/services/contributions.py` 的 METRICS）。 */
export type ContributionMetricKey = 'prs' | 'commits' | 'code' | 'issues' | 'wiki';

/** 贡献度五口径数值（`full_metrics` 的 JSON 形状）。 */
export interface ContributionMetrics {
  prs: number;
  commits: number;
  code_additions: number;
  code_deletions: number;
  code_total: number;
  issues: number;
  wiki: number;
}

/** 当前口径的展示元数据（summary 响应的 `metric_meta`）。 */
export interface MetricMeta {
  key: ContributionMetricKey;
  label: string;
  unit: string;
}

/** 贡献度汇总分组（组织 / 仓库两维度）。 */
export interface ContributionGroup {
  key: string;
  kind: 'org' | 'repo';
  name: string;
  full_name: string | null;
  contributor_count: number;
  metric_value: number;
  metrics: ContributionMetrics;
}

/** `GET /dashboard/contributions/summary` 的 data 载荷。 */
export interface ContributionsSummary {
  group_by: 'org' | 'repo';
  metric: ContributionMetricKey;
  range: { from: string | null; to: string | null };
  metric_meta: MetricMeta;
  totals: { metric_value: number; contributor_count: number; group_count: number };
  groups: ContributionGroup[];
}

/** 榜单每项的 `org` 块。 */
export interface ContributorOrg {
  key: string;
  display: string;
  source: string | null;
  confidence: number | null;
}

/** 榜单每项的 `repos[]` 切片。 */
export interface ContributorRepoSlice {
  id: string;
  full_name: string | null;
  metric_value: number;
}

/** 榜单每项（`contributor_id` 后端返回字符串，逐一对齐契约）。 */
export interface RankedContributor {
  rank: number;
  contributor_id: string;
  login: string | null;
  display_name: string | null;
  avatar_url: string | null;
  /** 明文邮箱（需求方 2026-09-22 拍板：明文、不脱敏）。 */
  email: string | null;
  email_masked: string | null;
  org: ContributorOrg;
  metrics: ContributionMetrics;
  metric_value: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  repos: ContributorRepoSlice[];
}

/** `GET /dashboard/contributions/leaderboard` 的 data 载荷。 */
export interface Leaderboard {
  dimension: 'org' | 'repo' | 'project';
  scope: string | null;
  metric: ContributionMetricKey;
  range: { from: string | null; to: string | null };
  total_contributors: number;
  contributors: RankedContributor[];
}

/** `GET /dashboard/contributors/{id}` 的 `contributions` 块。 */
export interface ContributorContributions {
  metrics: ContributionMetrics;
  by_org: Array<{
    org_id: string;
    key: string;
    name: string;
    metrics: ContributionMetrics;
  }>;
  by_repo: Array<{ id: string; full_name: string | null; metrics: ContributionMetrics }>;
}

/** 贡献者画像（`GET /dashboard/contributors/{id}` 扩展后的完整形状）。 */
export interface ContributorDetail {
  id: string;
  login: string | null;
  display_name: string | null;
  email: string | null;
  email_masked: string | null;
  company: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  orgs: Array<{
    org_id: string;
    name: string;
    kind: string;
    role: string | null;
    confidence: number;
    source: string;
  }>;
  repos: Array<{ id: string; full_name: string }>;
  activity: { commits: number; prs: number; reviews: number };
  contributions: ContributorContributions;
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
