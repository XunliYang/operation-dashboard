import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { PeopleSummaryCard } from './components/PeopleSummaryCard';
import { messages } from './i18n';
import { PeoplePage } from './pages/PeoplePage';

const plugin = {
  id: 'people',
  order: 30,
  titleKey: 'people.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/people', titleKey: 'people.title' });
    ctx.registerRoute({ path: 'people', element: createElement(PeoplePage) });
    // 工作台/总览摘要卡：与 LEOY-12 复用 `overview.card` 插槽（先落地的一方约定 key）。
    ctx.registerSlot('overview.card', 'people-summary', createElement(PeopleSummaryCard));
  },
} satisfies Plugin;

export default plugin;