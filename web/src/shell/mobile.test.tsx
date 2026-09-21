import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { ShellApp } from '@/shell/ShellApp';
import type { NavItem } from '@/shell/contract';

const NAV: NavItem[] = [
  { to: '/overview', titleKey: 'overview.title' },
  { to: '/repos', titleKey: 'repos.title' },
  { to: '/people', titleKey: 'people.title' },
];

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** 安装可切换的 window.matchMedia mock（jsdom 默认无此 API）。 */
function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: '(max-width: 767px)',
    onchange: null,
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    addListener: (cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeListener: (cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
  return { mql, listeners };
}

function renderShell(path = '/overview') {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<ShellApp navItems={NAV} headerActions={[]} />}>
            <Route path="overview" element={<div>OVERVIEW PAGE</div>} />
            <Route path="repos" element={<div>REPOS PAGE</div>} />
            <Route path="people" element={<div>PEOPLE PAGE</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ShellApp 移动端响应式', () => {
  it('窄屏下顶栏横向导航隐藏，汉堡按钮收纳进抽屉', () => {
    mockMatchMedia(true);
    renderShell();

    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument();
    // 抽屉初始关闭，导航项不在文档中
    expect(screen.queryByRole('link', { name: 'overview.title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));

    const drawer = screen.getByRole('dialog', { name: '站点导航' });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'overview.title' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'repos.title' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'people.title' })).toBeInTheDocument();
  });

  it('桌面宽度下正常渲染横向导航，不出现汉堡按钮', () => {
    mockMatchMedia(false);
    renderShell();

    expect(screen.queryByRole('button', { name: /菜单/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'overview.title' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('遮罩点击关闭抽屉', () => {
    mockMatchMedia(true);
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(document.querySelector('.shell-drawer-mask')!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Escape 关闭抽屉且焦点回到汉堡按钮', () => {
    mockMatchMedia(true);
    renderShell();
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('抽屉内点击导航项：跳转路由并自动关闭抽屉', () => {
    mockMatchMedia(true);
    renderShell('/overview');
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'repos.title' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('REPOS PAGE')).toBeInTheDocument();
  });

  it('抽屉打开后焦点进入首项导航，Tab 循环焦点陷阱生效', () => {
    mockMatchMedia(true);
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }));

    const first = screen.getByRole('link', { name: 'overview.title' });
    const last = screen.getByRole('link', { name: 'people.title' });
    expect(document.activeElement).toBe(first);

    // Shift+Tab 在首项上回卷到最后一项
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});