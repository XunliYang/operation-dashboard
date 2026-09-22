/**
 * 运行时装配：遍历 `plugins` 逐个调用 `register(ctx)`，把收集到的
 * route / nav / messages / slot 交给 `createBrowserRouter` 与 i18n store。
 *
 * register 期校验发生在这里：
 *   - 路由 path 冲突（两个插件注册同一 path 报错）
 *   - 导航项 to/titleKey 非空、to 不重复（与 registerRoute 同等严格）
 *   - i18n key 前缀合规（由 core/i18n 的 registerMessages 校验，这里补充插件上下文）
 */
import { createElement, Fragment } from 'react';
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
import { SlotOutlet } from './SlotOutlet';
import { plugins, RegistryValidationError } from './registry';

export interface ShellAssembly {
  routes: RouteObject[];
  navItems: NavItem[];
  slots: Record<SlotName, SlotRegistration[]>;
  /** register 期因非契约异常被跳过的插件 id，供壳层诊断用（契约违规仍会直接抛出）。 */
  skippedPluginIds: string[];
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

/**
 * register* 助手显式抛出的契约校验错误：path 冲突、导航项非法/重复、i18n 前缀不合规。
 * 属于「插件作者写错了」的硬错误，装配期必须 fail-fast（与既有 toThrow 断言对齐）。
 * 区别于插件 register() 内部偶发的业务异常：后者只跳过该插件，不拖垮整站。
 */
export class RegisterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterValidationError';
  }
}

export function assemble(pluginList: Plugin[], queryClient: QueryClient): ShellAssembly {
  const collected: CollectedRoute[] = [];
  const navItems: NavItem[] = [];
  const slotMap = new Map<SlotName, SlotRegistration[]>();
  const pathOwners = new Map<string, string>();
  const navOwners = new Map<string, string>();
  const skippedPluginIds: string[] = [];

  const registerMessagesGuarded = (pluginId: string, messages: PluginMessages): void => {
    try {
      registerMessages(pluginId, messages);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // i18n 前缀不合规属契约违规，仍须 fail-fast。
      throw new RegisterValidationError(`插件 "${pluginId}" 词条注册失败：${detail}`);
    }
  };

  for (const plugin of pluginList) {
    const id = plugin.id;

    // 逐插件暂存区：register* 产出先写到这里，register() 正常返回才一次性合并进全局，
    // 保证 register() 中途抛非契约异常时该插件不留下任何半成品路由 / 导航项 / 插槽。
    const stagedRoutes: CollectedRoute[] = [];
    const stagedNavItems: NavItem[] = [];
    const stagedSlots = new Map<SlotName, SlotRegistration[]>();
    const stagedPathOwners = new Map<string, string>();
    const stagedNavOwners = new Map<string, string>();

    const ctx: PluginContext = {
      registerRoute(route) {
        if (!route || typeof route.path !== 'string' || route.path === '') {
          throw new RegisterValidationError(`插件 "${id}" 注册了非法路由（缺少 path）`);
        }
        const normalized = route.path.replace(/^\/+/, '');
        const owner = stagedPathOwners.get(normalized);
        if (owner) {
          throw new RegisterValidationError(
            `路由 path "${normalized}" 冲突：插件 "${owner}" 与 "${id}" 重复注册`,
          );
        }
        stagedPathOwners.set(normalized, id);
        stagedRoutes.push({ route: { ...route, path: normalized }, owner: id });
      },
      registerNavItem(item) {
        if (!item || typeof item.to !== 'string' || item.to.trim() === '') {
          throw new RegisterValidationError(`插件 "${id}" 注册了非法导航项（缺少 to）`);
        }
        if (typeof item.titleKey !== 'string' || item.titleKey.trim() === '') {
          throw new RegisterValidationError(`插件 "${id}" 注册了非法导航项（缺少 titleKey）`);
        }
        const normalized = normalizePath(item.to);
        const owner = stagedNavOwners.get(normalized);
        if (owner) {
          throw new RegisterValidationError(
            `导航项 to "${normalized}" 冲突：插件 "${owner}" 与 "${id}" 重复注册`,
          );
        }
        stagedNavOwners.set(normalized, id);
        stagedNavItems.push(item);
      },
      registerMessages(messages) {
        registerMessagesGuarded(id, messages);
      },
      registerSlot(slot, key, node) {
        const list = stagedSlots.get(slot) ?? [];
        list.push({ key, node, owner: id });
        stagedSlots.set(slot, list);
      },
      on(event, handler) {
        return onShellEvent(event, handler);
      },
      api: { request: coreApi.request, api: coreApi.api },
      queryClient,
    };

    try {
      plugin.register(ctx);
    } catch (err) {
      // 契约违规（register* 助手的校验错误 / RegistryValidationError）继续向上抛，
      // 装配失败、行为与现状一致；其余为插件自身异常，记录并列 id 后跳过该插件。
      if (err instanceof RegisterValidationError || err instanceof RegistryValidationError) {
        throw err;
      }
      console.error(`[shell] 插件 "${id}" register 抛错（已跳过，不影响整站装配）:`, err);
      skippedPluginIds.push(id);
      continue;
    }

    // 提交暂存区：合并进全局，跨插件 path / nav 冲突照旧 fail-fast。
    for (const { route, owner } of stagedRoutes) {
      const normalized = route.path;
      const existing = pathOwners.get(normalized);
      if (existing) {
        throw new RegisterValidationError(
          `路由 path "${normalized}" 冲突：插件 "${existing}" 与 "${owner}" 重复注册`,
        );
      }
      pathOwners.set(normalized, owner);
      collected.push({ route, owner });
    }
    for (const item of stagedNavItems) {
      const normalized = normalizePath(item.to);
      const existing = navOwners.get(normalized);
      if (existing) {
        throw new RegisterValidationError(
          `导航项 to "${normalized}" 冲突：插件 "${existing}" 与 "${id}" 重复注册`,
        );
      }
      navOwners.set(normalized, id);
      navItems.push(item);
    }
    for (const [slot, list] of stagedSlots) {
      const existing = slotMap.get(slot);
      if (existing) existing.push(...list);
      else slotMap.set(slot, list);
    }
  }

  // 每个插件路由包一层错误边界：某插件抛错只在该页面降级，不整站白屏。
  const routes: RouteObject[] = collected.map(({ route, owner }) => wrapRoute(route, owner));

  return {
    routes,
    navItems,
    slots: Object.fromEntries(slotMap) as ShellAssembly['slots'],
    skippedPluginIds,
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

/** 规范化 path：去前导 `/`，与 registerRoute 的存储形式一致。 */
function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

/**
 * 从装配结果派生首页目标。内核不得硬编码任何插件 path。
 * 优先级：
 *   1. 第一个「to 确实命中已注册路由」的导航项（navItems 顺序 = 插件 order 升序）；
 *   2. 否则第一条插件路由；
 *   3. 插件集为空（无任何路由）时返回 null —— 调用方应渲染 404 兜底，而非重定向到不存在的路径。
 */
export function resolveHomePath(
  assembly: Pick<ShellAssembly, 'routes' | 'navItems'>,
): string | null {
  const registered = new Set(
    assembly.routes
      .map((route) => route.path)
      .filter((path): path is string => typeof path === 'string')
      .map(normalizePath),
  );

  for (const item of assembly.navItems) {
    const target = normalizePath(item.to);
    if (registered.has(target)) {
      return `/${target}`;
    }
  }

  const firstPath = assembly.routes[0]?.path;
  if (typeof firstPath === 'string' && normalizePath(firstPath) !== '') {
    return `/${normalizePath(firstPath)}`;
  }
  return null;
}

/**
 * 由装配结果构建壳层路由子树（index 首页重定向 + 插件路由 + 404 兜底）。
 * 单独导出，测试可经 createMemoryRouter 复用与生产完全一致的结构。
 */
export function buildShellRoutes(assembly: ShellAssembly): RouteObject[] {
  const homePath = resolveHomePath(assembly);
  const children: RouteObject[] = [
    // 首页目标派生自装配结果：有存活路由则重定向到计算出的首页；插件集为空时
    // 直接在 index 上渲染 404（`*` 兜底只匹配非空残留路径，/ 的 index 需要显式声明）。
    homePath
      ? { index: true, element: createElement(Navigate, { to: homePath, replace: true }) }
      : { index: true, element: createElement(NotFoundPage) },
    ...injectPageSlots(assembly.routes, assembly.slots),
    { path: '*', element: createElement(NotFoundPage, { homePath }) },
  ];
  return children;
}

/**
 * 页面级插槽宿主约定：`<page>.card` 插槽（如 `overview.card`）渲染在 `<page>` 路由页面上。
 * 页面名从槽名派生（`overview.card` → `overview`），内核不引用任何插件 id/path，
 * 沿用 `resolveHomePath` 已确立的「从装配结果派生、不硬编码」原则。
 *
 * 若同名路由不存在（页面插件被删）或该插槽无任何注册，注入函数原样返回路由数组，
 * 页面照常渲染、仅少卡片——插槽消费不依赖任何具体插件的存在。
 */
function injectPageSlots(
  routes: RouteObject[],
  slots: ShellAssembly['slots'],
): RouteObject[] {
  const overview = slots['overview.card'] ?? [];
  if (overview.length === 0) return routes;

  const hostPath = pagePathForSlot('overview.card');
  return routes.map((route) => {
    if (normalizePath(route.path ?? '') !== hostPath) return route;
    return {
      ...route,
      element: createElement(
        Fragment,
        null,
        route.element,
        createElement(SlotOutlet, { slots: overview, className: 'mt-6' }),
      ),
    };
  });
}

/** 从页面级槽名派生宿主路由路径：`overview.card` → `overview`。 */
function pagePathForSlot(slot: 'overview.card'): string {
  return slot.replace(/\.card$/, '');
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
      children: buildShellRoutes(assembly),
    },
  ]);
}
