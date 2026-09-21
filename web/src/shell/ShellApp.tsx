import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';

import { HealthIndicator } from '@/components/layout/HealthIndicator';
import { useI18n } from '@/core/i18n';
import type { NavItem } from './contract';

/** 横向顶栏最多直接展示的项数，超过则第 N+1 项起收纳进「更多」下拉。 */
const MAX_NAV_ITEMS = 6;

export interface ShellAppProps {
  navItems?: NavItem[];
  /** `header.action` 插槽内容，渲染在顶栏右侧工具区。 */
  headerActions?: ReactNode[];
  children?: ReactNode;
}

/**
 * 壳层布局：横向顶栏（56px、sticky、深色 --c-topbar）+ 内容区（--c-page 全宽）。
 * 顶栏左起 logo + 应用名，中间横向导航（插件 registerNavItem 声明，溢出进「更多」），
 * 右侧放身份 / 语言 / 主题切换与 `header.action` 插槽。
 */
export function ShellApp({ navItems = [], headerActions = [], children }: ShellAppProps) {
  const { t, locale, toggleLocale } = useI18n();
  const [theme, setTheme] = useState<string>(() =>
    typeof document !== 'undefined' ? (document.documentElement.dataset.theme ?? 'ocean') : 'ocean',
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const toggleTheme = () => setTheme((current) => (current === 'ocean' ? 'midnight' : 'ocean'));

  const visibleNav = navItems.slice(0, MAX_NAV_ITEMS);
  const overflowNav = navItems.slice(MAX_NAV_ITEMS);

  return (
    <div className="shell min-h-screen" style={{ background: 'var(--c-page)', color: 'var(--c-text)' }}>
      <header className="shell-topbar">
        <div className="shell-brand">
          <span className="shell-logo" aria-hidden="true">◆</span>
          <span className="shell-app-name">{t('app.title')}</span>
        </div>

        <nav className="shell-nav" aria-label="main">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `shell-nav-item${isActive ? ' is-active' : ''}`}
            >
              {t(item.titleKey)}
            </NavLink>
          ))}

          {overflowNav.length > 0 ? (
            <div ref={moreRef} className="shell-more">
              <button
                type="button"
                className="shell-nav-item"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                更多 ▾
              </button>
              {moreOpen ? (
                <div className="shell-more-menu" role="menu">
                  {overflowNav.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      role="menuitem"
                      className="shell-more-item"
                      onClick={() => setMoreOpen(false)}
                    >
                      {t(item.titleKey)}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </nav>

        <div className="shell-actions">
          {headerActions}
          <HealthIndicator />
          <span className="shell-identity" title="当前用户" aria-label="当前用户">运</span>
          <button type="button" className="shell-action-btn" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'ocean' ? '🌙' : '☀️'}
          </button>
          <button type="button" className="shell-action-btn" onClick={toggleLocale}>
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>

      <main className="shell-content">{children ?? <Outlet />}</main>
    </div>
  );
}