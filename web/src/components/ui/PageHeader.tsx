import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** 页面标题区（使用壳层设计令牌，跟随 data-theme 换肤）。 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--c-text)' }}>
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--c-text3)' }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}