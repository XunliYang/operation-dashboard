/**
 * 运行时装配：遍历 `plugins` 逐个调用 `register(ctx)`，把收集到的
 * route / nav / messages / slot 交给 `createBrowserRouter` 与 i18n store。
 *
 * register 期校验发生在这里：
 *   - 路由 path 冲突（两个插件注册同一 path 报错）
 *   - i18n key 前缀合规（由 core/i18n 的 registerMessages 校验，这里补充插件上下文）
 */
import { createElement } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';

import * as coreApi from '@/core/api';
import { registerMessages } from '@/core/i18n';

import type {
  NavItem,
  Plugin,
  PluginContext,
  PluginMessages,
  PluginRoute,
  SlotName,
  SlotRegistration,
} from './contract';
import { NotFoundPage } from './NotFoundPage';
import { PluginBoundary } from './PluginBoundary';
import { ShellApp } from './ShellApp';
import { plugins } from './registry';

export interface ShellAssembly {
  routes: RouteObject[];
  navItems: NavItem[];
  slots: Record<SlotName, SlotRegistration[]>;
}

const shellListeners = new Map<string, Set<() => void>>();

/** 壳层事件总线：外部可经此向插件广播（如 collector 刷新后触发 `repos:changed`）。 */
export function emitShellEvent(event: string): void {
  const handlers = shellListeners.get(event);
  if (handlers) {
    for (const handler of handlers) handler();
  }
}

function onShellEvent(event: string, handler: () => void): () => void {
  let handlers = shellListeners.get(event);
  if (!handlers) {
    handlers = new Set();
    shellListeners.set(event, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

interface CollectedRoute {
  route: PluginRoute;
  owner: string;
}

export function assemble(pluginList: Plugin[], queryClient: QueryClient): ShellAssembly {
  const collected: CollectedRoute[] = [];
  const navItems: NavItem[] = [];
  const slotMap = new Map<SlotName, SlotRegistration[]>();
  const pathOwners = new Map<string, string>();

  const registerMessagesGuarded = (pluginId: string, messages: PluginMessages): void => {
    try {
      registerMessages(pluginId, messages);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`插件 "${pluginId}" 词条注册失败：${detail}`, { cause: err });
    }
  };

  for (const plugin of pluginList) {
    const id = plugin.id;

    const ctx: PluginContext = {
      registerRoute(route) {
        if (!route || typeof route.path !== 'string' || route.path === '') {
          throw new Error(`插件 "${id}" 注册了非法路由（缺少 path）`);
        }
        const normalized = route.path.replace(/^\/+/, '');
        const owner = pathOwners.get(normalized);
        if (owner) {
          throw new Error(`路由 path "${normalized}" 冲突：插件 "${owner}" 与 "${id}" 重复注册`);
        }
        pathOwners.set(normalized, id);
        collected.push({ route: { ...route, path: normalized }, owner: id });
      },
      registerNavItem(item) {
        navItems.push(item);
      },
      registerMessages(messages) {
        registerMessagesGuarded(id, messages);
      },
      registerSlot(slot, key, node) {
        const list = slotMap.get(slot) ?? [];
        list.push({ key, node });
        slotMap.set(slot, list);
      },
      on(event, handler) {
        return onShellEvent(event, handler);
      },
      api: { request: coreApi.request, api: coreApi.api },
      queryClient,
    };

    plugin.register(ctx);
  }

  // 每个插件路由包一层错误边界：某插件抛错只在该页面降级，不整站白屏。
  const routes: RouteObject[] = collected.map(({ route, owner }) => wrapRoute(route, owner));

  return {
    routes,
    navItems,
    slots: Object.fromEntries(slotMap) as ShellAssembly['slots'],
  };
}

function wrapRoute(route: PluginRoute, owner: string): RouteObject {
  const { Component, element, children, ...rest } = route;
  const node = element ?? (Component ? createElement(Component) : null);

  return {
    ...rest,
    ...(node == null ? {} : { element: createElement(PluginBoundary, { pluginId: owner }, node) }),
    ...(children ? { children: children.map((child) => wrapRoute(child, owner)) } : {}),
  };
}

/** 构建浏览器路由。默认用静态装配出的真实插件清单；测试可注入任意 pluginList。 */
export function createRouter(
  queryClient: QueryClient,
  pluginList: Plugin[] = plugins,
): ReturnType<typeof createBrowserRouter> {
  const assembly = assemble(pluginList, queryClient);

  return createBrowserRouter([
    {
      path: '/',
      element: createElement(ShellApp, {
        navItems: assembly.navItems,
        headerActions: (assembly.slots['header.action'] ?? []).map((slot) => slot.node),
      }),
      children: [
        { index: true, element: createElement(Navigate, { to: '/overview', replace: true }) },
        ...assembly.routes,
        { path: '*', element: createElement(NotFoundPage) },
      ],
    },
  ]);
}
