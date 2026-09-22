import { createElement } from 'react';

import type { SlotRegistration } from './contract';
import { PluginBoundary } from './PluginBoundary';

export interface SlotOutletProps {
  /** 同一插槽名下按注册顺序收集的节点（key 用于 React reconciliation，owner 用于错误边界文案）。 */
  slots: SlotRegistration[];
  /** 追加到网格容器的类名（如 `mt-6`），缺省为空。 */
  className?: string;
}

/**
 * 壳层插槽渲染出口：把某插槽名下收集到的节点按注册顺序渲染进一个响应式卡片网格。
 *
 * 空插槽（无任何插件注册）渲染 `null`，不产生占位网格——保证「插件被删 / 未注册」时
 * 页面照常渲染。每个节点各包一层 `PluginBoundary`：单个插槽卡 render 抛错只降级该卡，
 * 不拖垮所在页面（与 `wrapRoute` 对插件路由的隔离策略一致）。
 */
export function SlotOutlet({ slots, className = '' }: SlotOutletProps) {
  if (slots.length === 0) return null;

  return (
    <div className={`grid min-w-0 gap-4 lg:grid-cols-2 ${className}`.trim()}>
      {slots.map(({ key, node, owner }) =>
        createElement(PluginBoundary, { key, pluginId: owner }, node),
      )}
    </div>
  );
}
