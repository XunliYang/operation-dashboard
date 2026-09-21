import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { useI18n } from '@/core/i18n';
import { MetricCard } from '@/shell/MetricCard';

import { peopleApi } from '@/plugins/people/api';

/** `overview.card` 插槽 · 人员结构摘要卡（复用 shell/MetricCard，供工作台/总览引用）。 */
export function PeopleSummaryCard() {
  const { t } = useI18n();
  const board = useQuery({ queryKey: ['people', 'board'], queryFn: () => peopleApi.board() });
  const s = board.data?.summary;

  return (
    <Card title={t('people.title')} description={t('people.description')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={t('people.summary.total')} value={s?.total_contributors ?? '—'} />
        <MetricCard label={t('people.summary.orgs')} value={s?.total_orgs ?? '—'} />
        <MetricCard label={t('people.summary.unclassified')} value={s?.unclassified_count ?? '—'} />
        <MetricCard label={t('people.summary.alerts')} value={s?.alerts.length ?? '—'} />
      </div>
    </Card>
  );
}
