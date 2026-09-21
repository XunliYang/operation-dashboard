import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

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
  },
} satisfies Plugin;

export default plugin;