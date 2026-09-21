import type { ReactNode } from 'react';

export interface MetricCardProps {
  /** 指标名（小号 --c-text3）。 */
  label: string;
  /** 大号数值（等宽数字，避免数值变化时宽度跳动）。 */
  value: string | number;
  /** 左侧图标。 */
  icon?: ReactNode;
  /** 可选单位（如 %）。 */
  unit?: string;
  /** 可选前缀（如 + / -）。 */
  prefix?: string;
}

/** 壳层通用指标卡：指标名 + 大数值 + 左侧图标 + 可选单位/前缀。供工作台与 Phase 2 复用。 */
export function MetricCard({ label, value, icon, unit, prefix }: MetricCardProps) {
  return (
    <div className="rounded-lg border p-4" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
      <div className="flex items-center gap-3">
        {icon ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-xs" style={{ color: 'var(--c-text3)' }}>{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
            {prefix}
            {value}
            {unit}
          </p>
        </div>
      </div>
    </div>
  );
}