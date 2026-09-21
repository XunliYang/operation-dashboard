import { useI18n } from '@/core/i18n';
import { ListCard } from '@/shell/ListCard';

import type { Member, OrgNode } from '@/plugins/people/api';
import { githubAvatar, githubProfile } from '@/plugins/people/api';
import { TierBadge } from '@/plugins/people/components/TierBadge';

/** 来源标签（与后端 source 值一一对应）。 */
const SOURCE_LABEL: Record<string, string> = {
  manual_yaml: 'manual_yaml',
  api: 'api',
  email_domain: 'email_domain',
  inferred: 'inferred',
};

function sourceLabel(source: string | null): string {
  return source ? (SOURCE_LABEL[source] ?? source) : '—';
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

interface OrgTreeProps {
  orgs: OrgNode[];
  onSelectMember: (id: string) => void;
}

/** 组织树（Org → Team → Member）：各层贡献占比 + 成员分层。 */
export function OrgTree({ orgs, onSelectMember }: OrgTreeProps) {
  return (
    <div className="space-y-4">
      {orgs.map((org) => (
        <OrgCard key={org.id} org={org} onSelectMember={onSelectMember} />
      ))}
    </div>
  );
}

function OrgCard({ org, onSelectMember }: { org: OrgNode; onSelectMember: (id: string) => void }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
          {org.name}
        </span>
        <span className="text-xs" style={{ color: 'var(--c-text3)' }}>
          {org.member_count} 人 · {percent(org.contribution_share)}
        </span>
      </div>

      <MemberList members={org.members} onSelectMember={onSelectMember} />

      {org.teams.length > 0 ? (
        <div className="mt-3 space-y-3 border-l-2 pl-3" style={{ borderColor: 'var(--c-border2)' }}>
          {org.teams.map((team) => (
            <div key={team.id}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--c-text2)' }}>
                  {team.name}
                </span>
                <span className="text-xs" style={{ color: 'var(--c-text3)' }}>
                  {team.member_count} 人 · {percent(team.contribution_share)}
                </span>
              </div>
              <MemberList members={team.members} onSelectMember={onSelectMember} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MemberList({
  members,
  onSelectMember,
}: {
  members: Member[];
  onSelectMember: (id: string) => void;
}) {
  if (members.length === 0) {
    return null;
  }
  return (
    <ul>
      {members.map((m, index) => (
        <li
          key={m.id}
          style={index === 0 ? undefined : { borderTop: '1px solid var(--c-border2)' }}
        >
          <MemberRow member={m} onSelect={() => onSelectMember(m.id)} />
        </li>
      ))}
    </ul>
  );
}

function MemberRow({ member, onSelect }: { member: Member; onSelect: () => void }) {
  const { t } = useI18n();
  const login = member.login ?? `#${member.id}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-1 py-2 text-left"
      style={{ color: 'var(--c-text)' }}
    >
      <img
        src={githubAvatar(login)}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={githubProfile(login)}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-medium"
            style={{ color: 'var(--c-primary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            @{login}
          </a>
          {member.role ? (
            <span className="text-xs" style={{ color: 'var(--c-text3)' }}>
              {t('people.role.maintainer')}
            </span>
          ) : null}
          <TierBadge tier={member.tier} />
        </div>
        <div className="mt-0.5 text-xs" style={{ color: 'var(--c-text3)' }}>
          {sourceLabel(member.source)}
          {typeof member.confidence === 'number' ? ` · conf ${member.confidence.toFixed(2)}` : ''}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs" style={{ color: 'var(--c-text2)' }}>
        <span className="tabular-nums">{member.contributions}</span>{' '}
        <span style={{ color: 'var(--c-text3)' }}>{t('people.metric.contributions')}</span>
      </div>
    </button>
  );
}

/** 待归类成员（显式呈现，不静默丢弃）。 */
export function UnclassifiedCard({
  members,
  onSelectMember,
}: {
  members: Member[];
  onSelectMember: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ListCard
      title={t('people.unclassified.title')}
      count={members.length}
      items={members.map((m) => ({
        title: `@${m.login ?? m.id}`,
        onClick: () => onSelectMember(m.id),
      }))}
    />
  );
}
