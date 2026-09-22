import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';
import { ListCard } from '@/shell/ListCard';
import type { ListCardItem } from '@/shell/ListCard';
import { MetricCard } from '@/shell/MetricCard';

import { workbenchApi } from '@/plugins/workbench/api';

/** 工作台 · 六张指标卡 + 三张清单卡（停滞 TOP10 / 健康度下滑 TOP10 / 最近发布）。 */
export function WorkbenchPage() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['workbench', 'overview'],
    queryFn: () => workbenchApi.overview(),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <div>
        <PageHeader title={t('workbench.title')} description={t('workbench.description')} />
        <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
          {t('common.loading')}
        </p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div>
        <PageHeader title={t('workbench.title')} description={t('workbench.description')} />
        <EmptyState title={t('workbench.loadFailed')} />
      </div>
    );
  }

  const data = query.data;

  const stalledItems: ListCardItem[] = data.lists.stalled_repos.map((it) => ({
    priority:
      it.days_since_commit == null ? t('workbench.noCommit') : `${it.days_since_commit}${t('workbench.daysUnit')}`,
    title: it.full_name,
    to: it.to,
  }));
  const dropItems: ListCardItem[] = data.lists.health_drops.map((it) => ({
    priority: `↓${it.drop}`,
    title: it.full_name,
    to: it.to,
  }));
  const releaseItems: ListCardItem[] = data.lists.recent_releases.map((it) => ({
    priority: it.merged_at ? it.merged_at.slice(0, 10) : undefined,
    title: it.title ? `${it.title} · ${it.full_name}` : it.full_name,
    to: it.to,
  }));

  return (
    <div>
      <PageHeader title={t('workbench.title')} description={t('workbench.description')} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label={t('workbench.metric.stalled')} value={data.stalled_repos} />
        <MetricCard label={t('workbench.metric.healthDrop')} value={data.health_drops.length} />
        <MetricCard label={t('workbench.metric.reviewBacklog')} value={data.review_backlog} />
        <MetricCard label={t('workbench.metric.unlinkedPrs')} value={data.unlinked_prs} />
        <MetricCard label={t('workbench.metric.slowResponse')} value={data.slow_issue_response} />
        <MetricCard
          label={t('workbench.metric.unclassified')}
          value={data.unclassified_people ?? t('workbench.metric.pendingPhase2')}
        />
      </div>

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-3">
        <ListCard
          title={t('workbench.list.stalled')}
          count={data.lists.stalled_repos.length}
          items={stalledItems}
        />
        <ListCard
          title={t('workbench.list.healthDrop')}
          count={data.lists.health_drops.length}
          items={dropItems}
        />
        <ListCard
          title={t('workbench.list.recentReleases')}
          count={data.lists.recent_releases.length}
          items={releaseItems}
        />
      </div>
    </div>
  );
}