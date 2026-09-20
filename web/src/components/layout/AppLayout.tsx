import { NavLink, Outlet } from 'react-router-dom';

import { useI18n } from '@/core/i18n';
import type { MessageKey } from '@/core/i18n';
import { useUiStore } from '@/core/stores';

import { HealthIndicator } from './HealthIndicator';

const NAV_ITEMS: Array<{ to: string; key: MessageKey }> = [
  { to: '/overview', key: 'nav.overview' },
  { to: '/repos', key: 'nav.repos' },
  { to: '/people', key: 'nav.people' },
  { to: '/sentiment', key: 'nav.sentiment' },
  { to: '/settings', key: 'nav.settings' },
];

/** 应用外壳：侧边导航 + 内容区。 */
export function AppLayout() {
  const { t, locale, toggleLocale } = useI18n();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside
        className={`flex flex-col border-r border-slate-200 bg-white transition-all ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="toggle sidebar"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            ☰
          </button>
          {!collapsed ? (
            <span className="truncate text-sm font-semibold">{t('app.title')}</span>
          ) : null}
        </div>

        <nav className="flex-1 space-y-1 p-2" aria-label="main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {collapsed ? t(item.key).slice(0, 1) : t(item.key)}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={toggleLocale}
            className="w-full rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-slate-200 bg-white px-6">
          <HealthIndicator />
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
