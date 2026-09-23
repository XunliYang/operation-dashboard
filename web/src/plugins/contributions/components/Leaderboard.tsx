import { useI18n } from '@/core/i18n';

import { githubProfile } from '@/core/api/github';

import { METRIC_KEYS, formatNumber, type ContributionMetricKey, type RankedContributor } from '@/plugins/contributions/api';

interface LeaderboardProps {
  contributors: RankedContributor[];
  metric: ContributionMetricKey;
  onSelect: (contributorId: string) => void;
}

/** 榜单表：rank · 头像·@login · 明文邮箱 · 组织标签 · 五口径数值（主口径高亮）。 */
export function Leaderboard({ contributors, metric, onSelect }: LeaderboardProps) {
  const { t } = useI18n();

  const thCls = 'px-3 py-2 text-left text-xs font-medium';
  const thStyle = { color: 'var(--c-text3)' } as const;

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
      <table className="w-full min-w-[720px] text-sm" style={{ color: 'var(--c-text)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-border2)', background: 'var(--c-surface2)' }}>
            <th className={thCls} style={{ ...thStyle, width: 56 }}>
              {t('contributions.leaderboard.rank')}
            </th>
            <th className={thCls} style={thStyle}>
              {t('contributions.leaderboard.contributor')}
            </th>
            <th className={thCls} style={thStyle}>
              {t('contributions.leaderboard.email')}
            </th>
            <th className={thCls} style={thStyle}>
              {t('contributions.leaderboard.org')}
            </th>
            {METRIC_KEYS.map((m) => (
              <th
                key={m}
                className={`${thCls} text-right`}
                style={{
                  ...thStyle,
                  fontWeight: m === metric ? 700 : undefined,
                  color: m === metric ? 'var(--c-primary)' : 'var(--c-text3)',
                }}
              >
                {t(`contributions.metric.${m}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contributors.map((c) => {
            const active = METRIC_KEYS.indexOf(metric);
            return (
              <tr
                key={c.contributor_id}
                tabIndex={0}
                role="button"
                aria-label={`${c.rank} ${c.login ?? `#${c.contributor_id}`}`}
                onClick={() => onSelect(c.contributor_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(c.contributor_id);
                  }
                }}
                className="cursor-pointer focus:outline-none"
                style={{ borderBottom: '1px solid var(--c-border2)' }}
              >
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--c-text3)' }}>
                  {c.rank}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {c.avatar_url ? (
                      <img
                        src={c.avatar_url}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full"
                        loading="lazy"
                      />
                    ) : null}
                    {c.login ? (
                      <a
                        href={githubProfile(c.login)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="truncate font-medium"
                        style={{ color: 'var(--c-primary)' }}
                      >
                        @{c.login}
                      </a>
                    ) : (
                      <span className="truncate font-medium" style={{ color: 'var(--c-text2)' }}>
                        #{c.contributor_id}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--c-text2)' }}>
                  {c.email ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="inline-flex rounded-full px-2 py-0.5 text-xs"
                    style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
                  >
                    {c.org.display}
                  </span>
                </td>
                {METRIC_KEYS.map((m, i) => (
                  <td
                    key={m}
                    className="px-3 py-2 text-right tabular-nums"
                    style={
                      i === active
                        ? { color: 'var(--c-primary)', fontWeight: 700 }
                        : { color: 'var(--c-text2)' }
                    }
                  >
                    {formatNumber(m === 'code' ? c.metrics.code_total : c.metrics[m])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}