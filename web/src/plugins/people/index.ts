import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

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
  },
} satisfies Plugin;

export default plugin;