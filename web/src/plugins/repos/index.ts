import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { messages } from './i18n';
import { RepoDetailPage } from './pages/RepoDetailPage';
import { ReposPage } from './pages/ReposPage';

const plugin = {
  id: 'repos',
  order: 20,
  titleKey: 'repos.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/repos', titleKey: 'repos.title' });
    ctx.registerRoute({ path: 'repos', element: createElement(ReposPage) });
    ctx.registerRoute({ path: 'repos/:id', element: createElement(RepoDetailPage) });
  },
} satisfies Plugin;

export default plugin;