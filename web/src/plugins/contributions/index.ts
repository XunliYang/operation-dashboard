import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { messages } from './i18n';
import { ContributionsPage } from './pages/ContributionsPage';

const plugin = {
  id: 'contributions',
  order: 25,
  titleKey: 'contributions.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/contributions', titleKey: 'contributions.title' });
    ctx.registerRoute({ path: 'contributions', element: createElement(ContributionsPage) });
  },
} satisfies Plugin;

export default plugin;