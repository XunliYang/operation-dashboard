import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { messages } from './i18n';
import { OverviewPage } from './pages/OverviewPage';

const plugin = {
  id: 'overview',
  order: 10,
  titleKey: 'overview.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/overview', titleKey: 'overview.title' });
    ctx.registerRoute({ path: 'overview', element: createElement(OverviewPage) });
  },
} satisfies Plugin;

export default plugin;