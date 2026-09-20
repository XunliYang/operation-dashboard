import { describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { routes } from '@/core/router';

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('router', () => {
  it('/ 重定向到 /overview', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: '总览' })).toBeInTheDocument();
  });

  it('/overview 直达渲染总览页', async () => {
    renderAt('/overview');
    expect(await screen.findByRole('heading', { level: 1, name: '总览' })).toBeInTheDocument();
  });

  it('/repos/:id 解析动态参数', async () => {
    renderAt('/repos/my-repo');
    expect(await screen.findByRole('heading', { level: 1, name: /my-repo/ })).toBeInTheDocument();
  });

  it.each([
    ['/repos', '仓库'],
    ['/people', '成员'],
    ['/sentiment', '舆情'],
    ['/settings', '设置'],
  ])('%s 渲染标题 %s', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('未知路由渲染 404', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { level: 1, name: '404' })).toBeInTheDocument();
  });

  it('侧边导航包含全部五个入口', () => {
    renderAt('/overview');
    const nav = screen.getByRole('navigation', { name: 'main' });
    for (const label of ['总览', '仓库', '成员', '舆情', '设置']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });
});
