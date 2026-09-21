import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

/** 空态 / 占位内容（使用壳层设计令牌，跟随 data-theme 换肤）。 */
export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <div
      className="rounded-lg border border-dashed p-8 text-center"
      style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--c-text2)' }}>
        {title}
      </p>
      {description ? (
        <p className="mt-1 text-sm" style={{ color: 'var(--c-text3)' }}>
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}