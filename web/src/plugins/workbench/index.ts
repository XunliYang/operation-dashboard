import { createElement } from 'react';

import type { Plugin } from '@/shell/contract';

import { WorkbenchAlertsCard } from './components/WorkbenchAlertsCard';
import { messages } from './i18n';
import { WorkbenchPage } from './pages/WorkbenchPage';

const plugin = {
  id: 'workbench',
  order: 0,
  titleKey: 'workbench.title',
  register(ctx) {
    ctx.registerMessages(messages);
    ctx.registerNavItem({ to: '/workbench', titleKey: 'workbench.title' });
    ctx.registerRoute({ path: 'workbench', element: createElement(WorkbenchPage) });
    // 告警摘要卡插进 /overview（overview.card 插槽，与 people / sentiment 复用同一插槽）。
    ctx.registerSlot('overview.card', 'workbench-alerts', createElement(WorkbenchAlertsCard));
  },
} satisfies Plugin;

export default plugin;