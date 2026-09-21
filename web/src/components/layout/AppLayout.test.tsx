import { describe, expect, it, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { routes } from '@/core/router';
import { useUiStore } from '@/core/stores';

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('AppLayout 响应式侧边栏', () => {
  beforeEach(() => {
    useUiStore.setState({ mobileSidebarOpen: false, sidebarCollapsed: false });
  });

  it('默认渲染移动端汉堡按钮，且侧栏处于抽屉收起态', () => {
    const { container } = renderAt('/overview');
    expect(screen.getByRole('button', { name: 'open sidebar' })).toBeInTheDocument();
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('-translate-x-full');
  });

  it('点击汉堡按钮展开抽屉并显示遮罩，点击遮罩关闭', () => {
    const { container } = renderAt('/overview');

    fireEvent.click(screen.getByRole('button', { name: 'open sidebar' }));

    expect(useUiStore.getState().mobileSidebarOpen).toBe(true);
    expect(container.querySelector('aside')?.className).toContain('translate-x-0');
    expect(screen.getByRole('button', { name: 'close sidebar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close sidebar' }));
    expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
  });

  it('点击导航链接后自动关闭抽屉', async () => {
    renderAt('/overview');

    fireEvent.click(screen.getByRole('button', { name: 'open sidebar' }));
    expect(useUiStore.getState().mobileSidebarOpen).toBe(true);

    const nav = screen.getByRole('navigation', { name: 'main' });
    const overviewLinks = Array.from(nav.querySelectorAll('a[href="/overview"]'));
    fireEvent.click(overviewLinks[0]);

    expect(useUiStore.getState().mobileSidebarOpen).toBe(false);
  });
});