import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { messages } from './i18n';
import { SettingsPage } from './pages/SettingsPage';

const plugin = {
  id: 'settings',
  order: 50,
  titleKey: 'settings.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/settings', titleKey: 'settings.title' });
    ctx.registerRoute({ path: 'settings', element: createElement(SettingsPage) });
  },
} satisfies Plugin;

export default plugin;