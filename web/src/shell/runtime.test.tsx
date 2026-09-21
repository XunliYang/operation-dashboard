import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { translate } from '@/core/i18n';
import { ShellApp } from '@/shell/ShellApp';
import { assemble, buildShellRoutes } from '@/shell/runtime';
import type { NavItem, Plugin } from '@/shell/contract';

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderAssembly(pluginList: Plugin[], path: string) {
  const queryClient = makeQueryClient();
  const assembly = assemble(pluginList, queryClient);
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ShellApp
            navItems={assembly.navItems}
            headerActions={(assembly.slots['header.action'] ?? []).map((s) => s.node)}
          />
        ),
        children: buildShellRoutes(assembly),
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('shell runtime', () => {
  it('空插件集不崩，装配出空路由与空导航', () => {
    const assembly = assemble([], makeQueryClient());
    expect(assembly.routes).toEqual([]);
    expect(assembly.navItems).toEqual([]);
  });

  it('registerMessages 合并后 t("repos.title") 命中', () => {
    const plugin: Plugin = {
      id: 'repos',
      order: 1,
      titleKey: 'repos.title',
      register(ctx) {
        ctx.registerMessages({ zh: { 'repos.title': '仓库' }, en: { 'repos.title': 'Repos' } });
      },
    };
    assemble([plugin], makeQueryClient());
    expect(translate('zh', 'repos.title')).toBe('仓库');
    expect(translate('en', 'repos.title')).toBe('Repos');
  });

  it('两个插件注册同一 path 报错', () => {
    const makePlugin = (id: string, order: number): Plugin => ({
      id,
      order,
      titleKey: `${id}.title`,
      register(ctx) {
        ctx.registerRoute({ path: 'dup', element: null });
      },
    });
    expect(() => assemble([makePlugin('a', 1), makePlugin('b', 2)], makeQueryClient())).toThrow(
      /冲突/,
    );
  });

  it('插件抛错被 boundary 捕获，降级为错误卡片', () => {
    function Boom(): never {
      throw new Error('boom');
    }
    const boomPlugin: Plugin = {
      id: 'boom',
      order: 1,
      titleKey: 'boom.title',
      register(ctx) {
        ctx.registerRoute({ path: 'boom', element: createElement(Boom) });
      },
    };

    renderAssembly([boomPlugin], '/boom');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/模块渲染失败/)).toBeInTheDocument();
  });

  it('抛错插件不影响其他插件正常渲染', () => {
    function Boom(): never {
      throw new Error('boom');
    }
    const boomPlugin: Plugin = {
      id: 'boom',
      order: 1,
      titleKey: 'boom.title',
      register(ctx) {
        ctx.registerRoute({ path: 'boom', element: createElement(Boom) });
      },
    };
    const okPlugin: Plugin = {
      id: 'ok',
      order: 2,
      titleKey: 'ok.title',
      register(ctx) {
        ctx.registerRoute({ path: 'ok', element: <div>OK PAGE</div> });
      },
    };

    renderAssembly([boomPlugin, okPlugin], '/ok');
    expect(screen.getByText('OK PAGE')).toBeInTheDocument();
  });

  it('导航项超过 6 项时第 7 项进入「更多」下拉', () => {
    const navItems: NavItem[] = Array.from({ length: 7 }, (_, i) => ({
      to: `/item${i + 1}`,
      titleKey: `item${i + 1}.title`,
    }));

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ShellApp navItems={navItems} headerActions={[]}>
            <div>content</div>
          </ShellApp>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    for (let i = 1; i <= 6; i++) {
      expect(screen.getByText(`item${i}.title`)).toBeInTheDocument();
    }
    expect(screen.queryByText('item7.title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /更多/ }));
    expect(screen.getByText('item7.title')).toBeInTheDocument();
  });

  it('删除 order 最小的首页插件后，/ 落到存活的首个插件（不出现 404）', () => {
    const surviving: Plugin = {
      id: 'people',
      order: 30,
      titleKey: 'people.title',
      register(ctx) {
        ctx.registerNavItem({ to: '/people', titleKey: 'people.title' });
        ctx.registerRoute({ path: 'people', element: <div>PEOPLE PAGE</div> });
      },
    };
    renderAssembly([surviving], '/');
    expect(screen.getByText('PEOPLE PAGE')).toBeInTheDocument();
    expect(screen.queryByText('页面不存在')).not.toBeInTheDocument();
  });

  it('新增 order 更小的插件后，/ 指向该新插件', () => {
    const makeHomePlugin = (id: string, order: number, path: string, label: string): Plugin => ({
      id,
      order,
      titleKey: `${id}.title`,
      register(ctx) {
        ctx.registerNavItem({ to: `/${path}`, titleKey: `${id}.title` });
        ctx.registerRoute({ path, element: <div>{label}</div> });
      },
    });
    renderAssembly(
      [makeHomePlugin('fresh', 1, 'fresh', 'FRESH PAGE'), makeHomePlugin('overview', 10, 'overview', 'OLD PAGE')],
      '/',
    );
    expect(screen.getByText('FRESH PAGE')).toBeInTheDocument();
    expect(screen.queryByText('OLD PAGE')).not.toBeInTheDocument();
  });

  it('空插件集下 / 渲染 404 兜底页且不崩', () => {
    renderAssembly([], '/');
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
  });

  it('导航项缺少 to 被拦截', () => {
    const plugin: Plugin = {
      id: 'x',
      order: 1,
      titleKey: 'x.title',
      register(ctx) {
        ctx.registerNavItem({ to: '', titleKey: 'x.title' });
      },
    };
    expect(() => assemble([plugin], makeQueryClient())).toThrow(/缺少 to/);
  });

  it('导航项 to 重复被拦截（规范化后比较，报错带插件 id）', () => {
    const makeNavPlugin = (id: string): Plugin => ({
      id,
      order: 1,
      titleKey: `${id}.title`,
      register(ctx) {
        ctx.registerNavItem({ to: '/dup', titleKey: `${id}.title` });
      },
    });
    expect(() => assemble([makeNavPlugin('a'), makeNavPlugin('b')], makeQueryClient())).toThrow(
      /导航项 to "dup" 冲突：插件 "a" 与 "b" 重复注册/,
    );
  });
});