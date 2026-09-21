import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';

import { HealthIndicator } from '@/components/layout/HealthIndicator';
import { useI18n } from '@/core/i18n';
import type { NavItem } from './contract';
import { useIsMobile } from './useMediaQuery';

/** 横向顶栏最多直接展示的项数，超过则第 N+1 项起收纳进「更多」下拉。 */
const MAX_NAV_ITEMS = 6;

/** 抽屉内可聚焦元素选择器，用于打开时的聚焦与 Tab 循环焦点陷阱。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

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
 *
 * 窄屏（<md，useIsMobile）下：横向导航收进汉堡抽屉，工具区仅保留主题 / 语言；
 * 抽屉具备遮罩点击关闭、导航跳转后关闭、Escape 关闭与焦点管理，插件零改动。
 */
export function ShellApp({ navItems = [], headerActions = [], children }: ShellAppProps) {
  const { t, locale, toggleLocale } = useI18n();
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState<string>(() =>
    typeof document !== 'undefined' ? (document.documentElement.dataset.theme ?? 'ocean') : 'ocean',
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // 回到桌面宽度时收起抽屉（断点由 CSS/JS 共用 767px，避免状态残留）。
  // React 官方推荐的「渲染期调整状态」模式：isMobile 变化即重置抽屉开关。
  const [prevIsMobile, setPrevIsMobile] = useState(isMobile);
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile);
    setMenuOpen(false);
  }

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

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuBtnRef.current?.focus();
  }, []);

  // 抽屉打开期：聚焦首个导航项、Tab 循环焦点陷阱、Escape 关闭、锁背景滚动。
  useEffect(() => {
    if (!menuOpen) return undefined;

    const panel = drawerRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const firstFocusable = focusables && focusables.length > 0 ? focusables[0] : null;
    (firstFocusable ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen, closeMenu]);

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

        {isMobile ? (
          <button
            ref={menuBtnRef}
            type="button"
            className="shell-menu-btn"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            aria-controls="shell-drawer"
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
        ) : (
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
        )}

        <div className="shell-actions">
          {headerActions}
          <div className="shell-health">
            <HealthIndicator />
          </div>
          <span className="shell-identity" title="当前用户" aria-label="当前用户">运</span>
          <button type="button" className="shell-action-btn" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'ocean' ? '🌙' : '☀️'}
          </button>
          <button type="button" className="shell-action-btn" onClick={toggleLocale}>
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>

      {isMobile && menuOpen ? (
        <div className="shell-drawer">
          <div className="shell-drawer-mask" onClick={closeMenu} aria-hidden="true" />
          <aside
            ref={drawerRef}
            id="shell-drawer"
            className="shell-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="站点导航"
          >
            <div className="shell-drawer-head">
              <span className="shell-identity" aria-hidden="true">运</span>
              <span className="shell-app-name">{t('app.title')}</span>
            </div>
            <nav className="shell-drawer-nav" aria-label="main">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `shell-drawer-item${isActive ? ' is-active' : ''}`}
                  onClick={closeMenu}
                >
                  {t(item.titleKey)}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      ) : null}

      <main className="shell-content">{children ?? <Outlet />}</main>
    </div>
  );
}