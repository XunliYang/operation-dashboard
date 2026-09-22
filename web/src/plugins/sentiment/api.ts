/** 看板 C · 舆情聚合 API（对应 api/app/routers/sentiment.py）。 */
import { request } from '@/core/api/client';

/** 舆情项目映射的目标仓库（显式 id 映射在服务端 config/sentiment_mapping.yaml）。 */
export const SENTIMENT_REPO = import.meta.env.VITE_SENTIMENT_REPO ?? 'XunliYang/operation-dashboard';

export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
}

export interface SentimentSummary {
  total: number;
  distribution: SentimentDistribution;
  ratio: SentimentDistribution;
  score: number;
  platforms: Array<{ source: string; count: number }>;
  spike_detected: boolean;
  last_updated: string | null;
}

export interface SentimentSummaryResponse {
  degraded: boolean;
  summary: SentimentSummary | null;
  reason?: string | null;
}

export interface SentimentDailyPoint {
  date: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  score: number;
}

export interface SentimentTimeseriesResponse {
  degraded: boolean;
  series: SentimentDailyPoint[] | null;
  reason?: string | null;
}

export interface SentimentRange {
  from?: string;
  to?: string;
}

function qs(range: SentimentRange): string {
  const search = new URLSearchParams();
  if (range.from) search.set('from', range.from);
  if (range.to) search.set('to', range.to);
  const s = search.toString();
  return s ? `&${s}` : '';
}

export const sentimentApi = {
  summary: (repo: string = SENTIMENT_REPO, range: SentimentRange = {}) =>
    request<SentimentSummaryResponse>(
      `/dashboard/sentiment/summary?repo=${encodeURIComponent(repo)}${qs(range)}`,
    ),
  timeseries: (repo: string = SENTIMENT_REPO, range: SentimentRange = {}) =>
    request<SentimentTimeseriesResponse>(
      `/dashboard/sentiment/timeseries?repo=${encodeURIComponent(repo)}${qs(range)}`,
    ),
};