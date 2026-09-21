import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface PluginBoundaryProps {
  pluginId: string;
  children?: ReactNode;
}

interface PluginBoundaryState {
  error: Error | null;
}

/**
 * 插件错误边界：某插件在 render 时抛错，只把它自己的页面降级为错误卡片，
 * 其余插件与壳层照常渲染，避免整站白屏。
 */
export class PluginBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
  state: PluginBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PluginBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[shell] 插件 "${this.props.pluginId}" 抛错:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="rounded-lg border p-6"
          style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <h2 className="text-base font-semibold" style={{ color: 'var(--c-text)' }}>
            模块渲染失败
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--c-text3)' }}>
            插件 <code>{this.props.pluginId}</code> 抛错，其余模块不受影响。
          </p>
          <p
            className="mt-2 max-h-40 overflow-auto rounded p-3 font-mono text-xs"
            style={{ background: 'var(--c-surface2)', color: 'var(--c-text2)' }}
          >
            {this.state.error.message}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
