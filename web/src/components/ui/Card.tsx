import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

/** 通用卡片容器（使用壳层设计令牌，跟随 data-theme 换肤）。 */
export function Card({ title, description, children, className = '' }: CardProps) {
  return (
    <section
      className={`rounded-lg border p-5 shadow-sm ${className}`}
      style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {title ? (
        <h2 className="text-base font-semibold" style={{ color: 'var(--c-text)' }}>
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="mt-1 text-sm" style={{ color: 'var(--c-text3)' }}>
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}