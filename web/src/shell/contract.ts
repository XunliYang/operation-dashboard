/**
 * 插件契约：微内核与子模块之间唯一的约定面。
 * 新增/删除子模块 = 增删 `plugins` 目录下的一个 `<id>/` 子目录，内核（shell/ core/）代码不动。
 * 插件之间零耦合；插件依赖方向只能是 plugins → shell/core，反向禁止（由 eslint 定向规则强制）。
 */
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';

/**
 * 壳层预留的插槽名。
 *
 * `nav` 已移除（LEOY-34）：它与 `registerNavItem` 表达同一件事，而顶栏导航完全由
 * `registerNavItem` 驱动，`registerSlot('nav', ...)` 会被静默丢弃，两套机制并存会让插件作者困惑。
 * 详见 LEOY-23 P2-3 的 ADR 结论。
 */
export type SlotName = 'overview.card' | 'header.action';

/** 壳层对外广播的事件。 */
export type ShellEvent = 'repos:changed';

/** 语言词表：locale -> key -> 文案。 */
export type MessageTable = Record<string, string>;
export type PluginMessages = Partial<Record<'zh' | 'en', MessageTable>>;

/**
 * 插件声明的路由。`path` 相对壳层根布局（不需要前导 `/`）；
 * `element` / `Component` 二选一，由壳层包一层 `PluginBoundary` 后交给 react-router。
 */
export interface PluginRoute {
  path: string;
  element?: ReactNode;
  Component?: ComponentType;
  children?: PluginRoute[];
}

/** 顶栏导航项。 */
export interface NavItem {
  to: string;
  titleKey: string;
}

/**
 * 一次插槽注册（slot -> 若干 {key, node, owner}）。
 *
 * `key` 与 `owner` 职责不同：
 *   - `key`：同一插槽内的节点标识，仅用于 React reconciliation（如 `people-summary`）；
 *   - `owner`：所属插件 id（如 `people`），错误边界据此显示真实插件名，用于排障定位。
 */
export interface SlotRegistration {
  key: string;
  node: ReactNode;
  owner: string;
}

/** 暴露给插件的 API 门面：复用内核信封解包，插件不得各自 fetch 外部地址。 */
export interface ApiFacade {
  request: typeof import('@/core/api/client').request;
  api: typeof import('@/core/api/client').api;
}

/** 壳层注入给插件的能力。 */
export interface PluginContext {
  registerRoute(route: PluginRoute): void;
  registerNavItem(item: NavItem): void;
  /** 增量合并词条；约定 key 带 `<插件id>.` 前缀（如 `repos.title`），前缀不合规会被拒绝。 */
  registerMessages(messages: PluginMessages): void;
  registerSlot(slot: SlotName, key: string, node: ReactNode): void;
  /** 订阅壳层事件，返回取消订阅函数。 */
  on(event: ShellEvent, handler: () => void): () => void;
  api: ApiFacade;
  queryClient: QueryClient;
}

/** 插件定义（唯一对外面）。 */
export interface Plugin {
  /** 全局唯一，等于 `plugins` 目录下的一级子目录名 `<id>`。 */
  id: string;
  /** 装配排序键（升序）；同时决定顶栏导航顺序。 */
  order: number;
  /** 插件显示名 i18n key（如 `repos.title`）。 */
  titleKey: string;
  /** 该模块依赖后端，后端不可达时壳层可据此提示（本阶段仅声明）。 */
  requiredBackend?: boolean;
  register(ctx: PluginContext): void;
}
