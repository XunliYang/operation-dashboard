import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { HealthRadarChart } from '@/components/charts/HealthRadarChart';
import { MetricTrendChart } from '@/components/charts/MetricTrendChart';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { CONTRIBUTION_METRIC_KEYS, contributionsApi, formatNumber } from '@/core/api/contributions';
import { queryKeys } from '@/core/api/queryKeys';
import { reposApi } from '@/core/api/repos';
import { useI18n } from '@/core/i18n';
import type { MetricPoint } from '@/core/types';

/** 仓库详情：五维雷达 + 关键指标卡 + 指标时序。 */
export function RepoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const repoId = id ?? '';

  const detail = useQuery({
    queryKey: queryKeys.repo(repoId),
    queryFn: () => reposApi.detail(repoId),
    enabled: repoId !== '',
  });

  const health = useQuery({
    queryKey: queryKeys.repoHealth(repoId, '30d'),
    queryFn: () => reposApi.health(repoId, { granularity: 'day' }),
    enabled: repoId !== '',
  });

  const commits = useQuery({
    queryKey: queryKeys.repoMetric(repoId, 'commits'),
    queryFn: () => reposApi.metrics(repoId, 'commits'),
    enabled: repoId !== '',
  });

  const radarData = (detail.data?.health.dimensions ?? []).map((d) => ({
    dimension: d.label,
    score: d.score,
  }));

  const healthSeries: MetricPoint[] = (health.data?.series ?? []).map((p) => ({
    date: p.date,
    value: p.score,
  }));

  const commitsSeries = commits.data?.series ?? [];
  const metrics = detail.data?.key_metrics;

  const metricCards: Array<{ label: string; value: number }> = [
    { label: '提交数（30 天）', value: metrics?.commits_30d ?? 0 },
    { label: '活跃贡献者', value: metrics?.active_contributors_30d ?? 0 },
    { label: '合并 PR', value: metrics?.prs_merged_30d ?? 0 },
    { label: '关闭 Issue', value: metrics?.issues_closed_30d ?? 0 },
    { label: 'Stars', value: metrics?.stars ?? 0 },
    { label: 'Forks', value: metrics?.forks ?? 0 },
    { label: 'Open Issues', value: metrics?.open_issues ?? 0 },
    { label: 'Open PRs', value: metrics?.open_prs ?? 0 },
  ];

  return (
    <div>
      <PageHeader
        title={detail.data ? detail.data.name : repoId || t('repos.title')}
        description={detail.data ? detail.data.full_name : undefined}
        actions={
          detail.data ? (
            <Badge tone={detail.data.health.score >= 60 ? 'success' : 'warning'}>
              健康分 {detail.data.health.score}
            </Badge>
          ) : null
        }
      />

      {detail.isError ? (
        <EmptyState title="加载仓库数据失败" description="请确认后端服务与数据采集已就绪。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="五维度健康度" description="0–100，权重见 config/health_weights.yaml">
            {detail.isLoading ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : radarData.length > 0 ? (
              <HealthRadarChart data={radarData} />
            ) : (
              <EmptyState title="暂无健康度数据" description="等待采集器写入事实数据。" />
            )}
          </Card>

          <Card title="关键指标">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((m) => (
                <div key={m.label} className="rounded-md bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{m.label}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{m.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="健康分趋势" description="按日粒度">
            {health.isLoading ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : healthSeries.length > 0 ? (
              <MetricTrendChart data={healthSeries} label="健康分" color="#3b82f6" />
            ) : (
              <EmptyState title="暂无健康分时序" />
            )}
          </Card>

          <Card title="提交趋势">
            {commits.isLoading ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : commitsSeries.length > 0 ? (
              <MetricTrendChart data={commitsSeries} label="提交数" color="#10b981" />
            ) : (
              <EmptyState title="暂无提交数据" />
            )}
          </Card>

          <ContributionCard repoId={repoId} />
        </div>
      )}
    </div>
  );
}

/** 仓库维度的贡献度卡片：五口径汇总 + TOP 贡献者 + 跳转贡献度看板。 */
function ContributionCard({ repoId }: { repoId: string }) {
  const { t } = useI18n();

  const summary = useQuery({
    queryKey: queryKeys.contributionsSummary('repo', 'commits', null, repoId, ''),
    queryFn: () => contributionsApi.summary({ groupBy: 'repo', metric: 'commits', repo: repoId }),
    enabled: repoId !== '',
  });

  const top = useQuery({
    queryKey: queryKeys.contributionsLeaderboard('repo', repoId, 'commits', ''),
    queryFn: () =>
      contributionsApi.leaderboard({ dimension: 'repo', scope: repoId, metric: 'commits', limit: 5 }),
    enabled: repoId !== '',
  });

  const group = summary.data?.groups?.[0];
  const topContributors = top.data?.contributors ?? [];

  return (
    <Card title={t('contributions.repoCard.title')} className="lg:col-span-2">
      {group ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid grid-cols-5 gap-2">
            {CONTRIBUTION_METRIC_KEYS.map((m) => (
              <div key={m} className="rounded-md bg-slate-50 p-2 text-center">
                <p className="text-xs text-slate-500">{t(`contributions.metric.${m}`)}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {formatNumber(m === 'code' ? group.metrics.code_total : group.metrics[m])}
                </p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500">
              {t('contributions.repoCard.top')}
            </p>
            <ul className="mt-2 space-y-1">
              {topContributors.map((c) => (
                <li
                  key={c.contributor_id}
                  className="flex items-center justify-between gap-2 py-1 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                    ) : null}
                    <span className="truncate">@{c.login ?? c.contributor_id}</span>
                  </span>
                  <span className="tabular-nums text-slate-500">{formatNumber(c.metric_value)}</span>
                </li>
              ))}
              {topContributors.length === 0 ? (
                <li className="text-sm text-slate-400">{t('common.loading')}</li>
              ) : null}
            </ul>
            <Link
              to={`/contributions?repo=${repoId}`}
              className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
            >
              {t('contributions.repoCard.viewAll')}
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
    </Card>
  );
}