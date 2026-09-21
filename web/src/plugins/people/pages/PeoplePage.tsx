import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';
import { ListCard } from '@/shell/ListCard';
import { MetricCard } from '@/shell/MetricCard';

import { peopleApi } from '@/plugins/people/api';
import type { MaintainerAlert, OrgBoard, Tier } from '@/plugins/people/api';
import { OrgTree, UnclassifiedCard } from './OrgTree';
import { ProfileDrawer } from './ProfileDrawer';

/** 看板 B · 人员组织分类：组织树 + 活跃度分层 + 停滞告警 + 待归类。 */
export function PeoplePage() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const board = useQuery({ queryKey: ['people', 'board'], queryFn: () => peopleApi.board() });

  return (
    <div>
      <PageHeader title={t('people.title')} description={t('people.description')} />

      {board.isError ? (
        <EmptyState title={t('people.loadFailed')} />
      ) : board.isLoading || !board.data ? (
        <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
          {t('common.loading')}
        </p>
      ) : (
        <div className="space-y-5">
          <Summary summary={board.data.summary} />

          <Alerts alerts={board.data.summary.alerts} onSelect={setSelected} />

          <Tiers tiers={board.data.summary.tiers} />

          {board.data.orgs.length > 0 ? (
            <OrgTree orgs={board.data.orgs} onSelectMember={setSelected} />
          ) : (
            <EmptyState title={t('people.empty')} />
          )}

          {board.data.unclassified.length > 0 ? (
            <UnclassifiedCard members={board.data.unclassified} onSelectMember={setSelected} />
          ) : null}
        </div>
      )}

      <ProfileDrawer contributorId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Summary({ summary }: { summary: OrgBoard['summary'] }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard label={t('people.summary.total')} value={summary.total_contributors} />
      <MetricCard label={t('people.summary.orgs')} value={summary.total_orgs} />
      <MetricCard label={t('people.summary.unclassified')} value={summary.unclassified_count} />
      <MetricCard label={t('people.summary.alerts')} value={summary.alerts.length} />
    </div>
  );
}

function Alerts({
  alerts,
  onSelect,
}: {
  alerts: MaintainerAlert[];
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  if (alerts.length === 0) {
    return null;
  }
  return (
    <ListCard
      title={t('people.alert.title')}
      count={alerts.length}
      items={alerts.map((a) => ({
        priority: `${a.days_inactive}${t('people.alert.dayUnit')}`,
        title: `@${a.login ?? a.id} · ${t('people.alert.day')} ${a.days_inactive} ${t('people.alert.dayUnit')}`,
        onClick: () => onSelect(String(a.id)),
      }))}
    />
  );
}

function Tiers({ tiers }: { tiers: Record<Tier, number> }) {
  const { t } = useI18n();
  const order: Tier[] = ['core', 'active', 'occasional', 'churned'];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {order.map((tier) => (
        <MetricCard key={tier} label={t(`people.tier.${tier}`)} value={tiers[tier] ?? 0} />
      ))}
    </div>
  );
}