import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

/** 空态 / 占位内容。 */
export function EmptyState({ title, description, children }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
