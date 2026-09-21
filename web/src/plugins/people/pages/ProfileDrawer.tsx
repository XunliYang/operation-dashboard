import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { useI18n } from '@/core/i18n';

import type { ContributorProfile } from '@/plugins/people/api';
import { githubAvatar, githubProfile, peopleApi } from '@/plugins/people/api';

interface ProfileDrawerProps {
  contributorId: string | null;
  onClose: () => void;
}

/** 人员画像抽屉：头像 + @login 外链 + 公司 + 邮箱（脱敏）+ 参与仓库 + 活跃概览。 */
export function ProfileDrawer({ contributorId, onClose }: ProfileDrawerProps) {
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: ['people', 'contributor', contributorId ?? ''],
    queryFn: () => peopleApi.contributor(contributorId as string),
    enabled: contributorId !== null,
  });

  if (contributorId === null) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('people.title')}
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
          <h2 className="text-lg font-semibold">{t('people.title')}</h2>
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

        {detail.isLoading ? <p style={{ color: 'var(--c-text3)' }}>{t('common.loading')}</p> : null}
        {detail.isError ? (
          <EmptyState title={t('people.loadFailed')} />
        ) : detail.data ? (
          <ProfileBody profile={detail.data} />
        ) : null}
      </aside>
    </div>
  );
}

function ProfileBody({ profile }: { profile: ContributorProfile }) {
  const { t } = useI18n();
  const login = profile.login ?? `#${profile.id}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <img
          src={githubAvatar(login)}
          alt=""
          className="h-12 w-12 rounded-full"
        />
        <div className="min-w-0">
          <a
            href={githubProfile(login)}
            target="_blank"
            rel="noreferrer"
            className="font-medium"
            style={{ color: 'var(--c-primary)' }}
          >
            @{login}
          </a>
          {profile.display_name ? (
            <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
              {profile.display_name}
            </p>
          ) : null}
        </div>
      </div>

      <Section title={t('people.drawer.orgs')}>
        {profile.orgs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text3)' }}>—</p>
        ) : (
          <ul className="space-y-1">
            {profile.orgs.map((o) => (
              <li key={o.org_id} className="text-sm" style={{ color: 'var(--c-text2)' }}>
                {o.name}
                <span className="ml-2 text-xs" style={{ color: 'var(--c-text3)' }}>
                  {o.source} · conf {o.confidence.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('people.drawer.company')}>
        <p className="text-sm" style={{ color: 'var(--c-text2)' }}>
          {profile.company ?? '—'}
        </p>
      </Section>

      <Section title={t('people.drawer.email')}>
        <p className="text-sm" style={{ color: 'var(--c-text2)' }}>
          {profile.email ?? '—'}
        </p>
      </Section>

      <Section title={t('people.drawer.repos')}>
        {profile.repos.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text3)' }}>—</p>
        ) : (
          <ul className="space-y-1">
            {profile.repos.map((r) => (
              <li key={r.id}>
                <a
                  href={`https://github.com/${r.full_name}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm"
                  style={{ color: 'var(--c-primary)' }}
                >
                  {r.full_name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('people.drawer.activity')}>
        <div className="grid grid-cols-3 gap-3">
          <ActivityStat label={t('people.drawer.commits')} value={profile.activity.commits} />
          <ActivityStat label={t('people.drawer.prs')} value={profile.activity.prs} />
          <ActivityStat label={t('people.drawer.reviews')} value={profile.activity.reviews} />
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--c-text3)' }}>
          {profile.first_seen_at ? `first ${profile.first_seen_at}` : ''}
          {profile.last_seen_at ? ` · last ${profile.last_seen_at}` : ''}
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ActivityStat({ label, value }: { label: string; value: number }) {
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