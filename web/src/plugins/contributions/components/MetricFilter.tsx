import { useI18n } from '@/core/i18n';

import {
  METRIC_KEYS,
  recentWindow,
  type ContributionsFilterState,
  type ContributionMetricKey,
  type Dimension,
  type OrgOption,
  type RepoOption,
} from '@/plugins/contributions/api';

interface MetricFilterProps {
  value: ContributionsFilterState;
  orgOptions: OrgOption[];
  repoOptions: RepoOption[];
  onChange: (next: ContributionsFilterState) => void;
}

const DIMENSIONS: Dimension[] = ['org', 'repo', 'project'];
const PRESETS = ['30d', '90d', 'custom'] as const;

/** 维度 Tab + 五口径筛选 + 时间窗 + 组织/仓库 scope 下拉。 */
export function MetricFilter({ value, orgOptions, repoOptions, onChange }: MetricFilterProps) {
  const { t } = useI18n();

  const setMetric = (metric: ContributionMetricKey) => onChange({ ...value, metric });

  const setDimension = (dimension: Dimension) =>
    onChange({ ...value, dimension, scope: null });

  const setPreset = (preset: ContributionsFilterState['preset']) => {
    if (preset === 'custom') {
      onChange({ ...value, preset });
      return;
    }
    const days = preset === '30d' ? 30 : 90;
    const { from, to } = recentWindow(days);
    onChange({ ...value, preset, from, to });
  };

  const setScope = (scope: string) =>
    onChange({ ...value, scope: scope === '' ? null : scope });

  const inputCls =
    'rounded-md border px-2 py-1 text-sm';
  const inputStyle = {
    background: 'var(--c-surface2)',
    borderColor: 'var(--c-border)',
    color: 'var(--c-text)',
  } as const;

  return (
    <div className="space-y-3">
      {/* 维度 Tab */}
      <div className="flex flex-wrap items-center gap-2">
        {DIMENSIONS.map((d) => {
          const active = d === value.dimension;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDimension(d)}
              className="rounded-full px-3 py-1 text-sm font-medium"
              style={{
                background: active ? 'var(--c-primary)' : 'var(--c-surface2)',
                color: active ? 'var(--c-text-invert, #fff)' : 'var(--c-text2)',
              }}
            >
              {t(`contributions.dimension.${d}`)}
            </button>
          );
        })}
      </div>

      {/* 口径 + 时间窗 + scope */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={value.metric}
          onChange={(e) => setMetric(e.target.value as ContributionMetricKey)}
          className={inputCls}
          style={inputStyle}
          aria-label={t('contributions.metric.label')}
        >
          {METRIC_KEYS.map((m) => (
            <option key={m} value={m}>
              {t(`contributions.metric.${m}`)}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {PRESETS.map((p) => {
            const active = p === value.preset;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className="rounded-md px-2 py-1 text-sm"
                style={{
                  background: active ? 'var(--c-primary-soft)' : 'var(--c-surface2)',
                  color: active ? 'var(--c-primary)' : 'var(--c-text2)',
                }}
              >
                {t(`contributions.range.${p}`)}
              </button>
            );
          })}
        </div>

        {value.preset === 'custom' ? (
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--c-text3)' }}>
              {t('contributions.range.from')}
            </label>
            <input
              type="date"
              value={value.from}
              max={value.to}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className={inputCls}
              style={inputStyle}
            />
            <label className="text-xs" style={{ color: 'var(--c-text3)' }}>
              {t('contributions.range.to')}
            </label>
            <input
              type="date"
              value={value.to}
              min={value.from}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className={inputCls}
              style={inputStyle}
            />
          </div>
        ) : null}

        {value.dimension !== 'project' ? (
          <select
            value={value.scope ?? ''}
            onChange={(e) => setScope(e.target.value)}
            className={inputCls}
            style={inputStyle}
            aria-label={
              value.dimension === 'org' ? t('contributions.scope.org') : t('contributions.scope.repo')
            }
          >
            <option value="">{t('contributions.scope.all')}</option>
            {value.dimension === 'org'
              ? orgOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                  </option>
                ))
              : repoOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}