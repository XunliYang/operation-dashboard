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

/** 阶段 1 占位：仓库概览数据形状，Phase 1 接入真实接口后再扩展。 */
export interface RepoSummary {
  id: string;
  name: string;
  /** 综合健康分，0–100 */
  healthScore: number;
  openIssues: number;
  openPRs: number;
  lastCommitAt: string | null;
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
