import type { PluginMessages } from '@/shell/contract';

/** 舆情插件词条，key 统一带 `sentiment.` 前缀。 */
export const messages: PluginMessages = {
  zh: {
    'sentiment.title': '舆情',
    'sentiment.description': '舆情情感聚合摘要',
    'sentiment.summary.total': '文档总量',
    'sentiment.summary.positive': '正面',
    'sentiment.summary.neutral': '中性',
    'sentiment.summary.negative': '负面',
    'sentiment.summary.score': '情感分',
    'sentiment.trend.title': '情感走势',
    'sentiment.trend.description': '区间内逐日情感分（-1 负面 ~ 1 正面）',
    'sentiment.spike': '负面突增',
    'sentiment.degraded': '数据陈旧',
    'sentiment.degraded.description': '舆情服务暂不可用，展示最近一次成功数据',
  },
  en: {
    'sentiment.title': 'Sentiment',
    'sentiment.description': 'Sentiment aggregation',
    'sentiment.summary.total': 'Documents',
    'sentiment.summary.positive': 'Positive',
    'sentiment.summary.neutral': 'Neutral',
    'sentiment.summary.negative': 'Negative',
    'sentiment.summary.score': 'Score',
    'sentiment.trend.title': 'Sentiment trend',
    'sentiment.trend.description': 'Daily sentiment score in range (-1 negative ~ 1 positive)',
    'sentiment.spike': 'Negative spike',
    'sentiment.degraded': 'Stale data',
    'sentiment.degraded.description': 'Sentiment service unavailable; showing last known data',
  },
};