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

/** 应用外壳：侧边导航 + 内容区。小屏（<md）下侧栏收为抽屉，由汉堡按钮触发。 */
export function AppLayout() {
  const { t, locale, toggleLocale } = useI18n();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const mobileOpen = useUiStore((s) => s.mobileSidebarOpen);
  const openMobileSidebar = useUiStore((s) => s.openMobileSidebar);
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* 小屏抽屉遮罩：点击关闭 */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="close sidebar"
          onClick={closeMobileSidebar}
          className="fixed inset-0 z-30 bg-slate-900/50 md:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-slate-200 bg-white transition-all duration-200 md:static md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-16' : 'md:w-56'}`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="toggle sidebar"
            className="hidden rounded p-1 text-slate-500 hover:bg-slate-100 md:inline-flex"
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
              onClick={closeMobileSidebar}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {/* 小屏抽屉始终显示完整标签，桌面折叠时才缩为首字母 */}
              <span className="md:hidden">{t(item.key)}</span>
              <span className="hidden md:inline">
                {collapsed ? t(item.key).slice(0, 1) : t(item.key)}
              </span>
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
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
          <button
            type="button"
            onClick={openMobileSidebar}
            aria-label="open sidebar"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 md:hidden"
          >
            ☰
          </button>
          <HealthIndicator />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
