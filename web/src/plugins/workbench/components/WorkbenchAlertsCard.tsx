import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { useI18n } from '@/core/i18n';
import { MetricCard } from '@/shell/MetricCard';

import { workbenchApi } from '@/plugins/workbench/api';

/** `overview.card` 插槽 · 工作台告警摘要卡（把最关键的风险顶到 /overview 首屏）。 */
export function WorkbenchAlertsCard() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['workbench', 'overview'],
    queryFn: () => workbenchApi.overview(),
    staleTime: 30_000,
  });

  const data = query.data ?? null;
  const degraded = query.isError || (query.isLoading === false && data === null);

  if (query.isLoading) {
    return (
      <Card title={t('workbench.alert.title')} description={t('workbench.alert.description')}>
        <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
          {t('common.loading')}
        </p>
      </Card>
    );
  }

  if (degraded) {
    return (
      <Card title={t('workbench.alert.title')} description={t('workbench.alert.description')}>
        <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
          {t('workbench.loadFailed')}
        </p>
      </Card>
    );
  }

  return (
    <Card title={t('workbench.alert.title')} description={t('workbench.alert.description')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={t('workbench.metric.stalled')} value={data?.stalled_repos ?? '—'} />
        <MetricCard
          label={t('workbench.metric.healthDrop')}
          value={data?.health_drops.length ?? '—'}
        />
        <MetricCard label={t('workbench.metric.reviewBacklog')} value={data?.review_backlog ?? '—'} />
        <MetricCard
          label={t('workbench.metric.unclassified')}
          value={data?.unclassified_people ?? t('workbench.metric.pendingPhase2')}
        />
      </div>
      <Link
        className="mt-3 inline-block text-sm no-underline"
        style={{ color: 'var(--c-primary)' }}
        to="/workbench"
      >
        {t('workbench.alert.viewAll')}
      </Link>
    </Card>
  );
}