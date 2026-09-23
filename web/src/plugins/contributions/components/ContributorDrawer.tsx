import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { githubAvatar, githubProfile } from '@/core/api/github';
import { queryKeys } from '@/core/api/queryKeys';
import { useI18n } from '@/core/i18n';

import { METRIC_KEYS, contributionsApi, formatNumber, type ContributorDetail } from '@/plugins/contributions/api';

interface ContributorDrawerProps {
  contributorId: string | null;
  onClose: () => void;
}

/** 贡献详情抽屉：五口径总量 metrics + 按组织 by_org + 按仓库 by_repo。 */
export function ContributorDrawer({ contributorId, onClose }: ContributorDrawerProps) {
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: queryKeys.contributorDetail(contributorId ?? ''),
    queryFn: () => contributionsApi.contributor(contributorId as string),
    enabled: contributorId !== null,
  });

  // Esc 关闭抽屉（键盘可达性，见 PR 复审 P2-6）。
  useEffect(() => {
    if (contributorId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contributorId, onClose]);

  if (contributorId === null) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('contributions.drawer.title')}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="relative h-full w-full max-w-md overflow-y-auto p-6"
        style={{ background: 'var(--c-surface)', color: 'var(--c-text)' }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{t('contributions.drawer.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm"
            style={{ color: 'var(--c-text3)' }}
            aria-label="close"
          >
            ✕
          </button>
        </div>

        {detail.isLoading ? (
          <p style={{ color: 'var(--c-text3)' }}>{t('common.loading')}</p>
        ) : detail.isError ? (
          <EmptyState title={t('contributions.loadFailed')} />
        ) : detail.data ? (
          <DrawerBody data={detail.data} />
        ) : null}
      </aside>
    </div>
  );
}

function DrawerBody({ data }: { data: ContributorDetail }) {
  const { t } = useI18n();
  const login = data.login;
  const c = data.contributions;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        {login ? (
          <img src={githubAvatar(login)} alt="" className="h-12 w-12 rounded-full" />
        ) : null}
        <div className="min-w-0">
          {login ? (
            <a
              href={githubProfile(login)}
              target="_blank"
              rel="noreferrer"
              className="font-medium"
              style={{ color: 'var(--c-primary)' }}
            >
              @{login}
            </a>
          ) : (
            <span className="font-medium" style={{ color: 'var(--c-text)' }}>
              #{data.id}
            </span>
          )}
          {data.display_name ? (
            <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
              {data.display_name}
            </p>
          ) : null}
        </div>
      </div>

      <Section title={t('contributions.drawer.email')}>
        <p className="text-sm" style={{ color: 'var(--c-text2)' }}>
          {data.email ?? '—'}
        </p>
      </Section>

      <Section title={t('contributions.drawer.metrics')}>
        <div className="grid grid-cols-2 gap-2">
          {METRIC_KEYS.map((m) => (
            <div
              key={m}
              className="rounded-md border p-3"
              style={{ background: 'var(--c-surface2)', borderColor: 'var(--c-border)' }}
            >
              <p className="text-xs" style={{ color: 'var(--c-text3)' }}>
                {t(`contributions.metric.${m}`)}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
                {formatNumber(m === 'code' ? c.metrics.code_total : c.metrics[m])}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('contributions.drawer.byOrg')}>
        {c.by_org.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text3)' }}>—</p>
        ) : (
          <ul className="space-y-2">
            {c.by_org.map((o) => (
              <li
                key={o.org_id}
                className="rounded-md border p-2 text-sm"
                style={{ borderColor: 'var(--c-border)' }}
              >
                <span className="font-medium" style={{ color: 'var(--c-text)' }}>
                  {o.name}
                </span>
                <span className="ml-2 tabular-nums" style={{ color: 'var(--c-text2)' }}>
                  {formatNumber(o.metrics.commits)} {t('contributions.metric.commits')} ·{' '}
                  {formatNumber(o.metrics.code_total)} {t('contributions.metric.code')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('contributions.drawer.byRepo')}>
        {c.by_repo.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text3)' }}>—</p>
        ) : (
          <ul className="space-y-1">
            {c.by_repo.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between py-1 text-sm"
                style={{ borderBottom: '1px solid var(--c-border2)' }}
              >
                <span style={{ color: 'var(--c-text)' }}>{r.full_name ?? r.id}</span>
                <span className="tabular-nums" style={{ color: 'var(--c-text2)' }}>
                  {formatNumber(r.metrics.commits)} {t('contributions.metric.commits')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('contributions.drawer.activity')}>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t('contributions.drawer.commits')} value={data.activity.commits} />
          <Stat label={t('contributions.drawer.prs')} value={data.activity.prs} />
          <Stat label={t('contributions.drawer.reviews')} value={data.activity.reviews} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-md border p-3 text-center"
      style={{ background: 'var(--c-surface2)', borderColor: 'var(--c-border)' }}
    >
      <p className="text-xs" style={{ color: 'var(--c-text3)' }}>
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
        {value}
      </p>
    </div>
  );
}