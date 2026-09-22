import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { SentimentSummaryCard } from './components/SentimentSummaryCard';
import { messages } from './i18n';
import { SentimentPage } from './pages/SentimentPage';

const plugin = {
  id: 'sentiment',
  order: 40,
  titleKey: 'sentiment.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/sentiment', titleKey: 'sentiment.title' });
    ctx.registerRoute({ path: 'sentiment', element: createElement(SentimentPage) });
    // 工作台/总览摘要卡：与 people 插件复用 `overview.card` 插槽（含降级态）。
    ctx.registerSlot('overview.card', 'sentiment-summary', createElement(SentimentSummaryCard));
  },
} satisfies Plugin;

export default plugin;