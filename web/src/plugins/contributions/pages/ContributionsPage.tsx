import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { queryKeys } from '@/core/api/queryKeys';
import { reposApi } from '@/core/api/repos';
import { useI18n } from '@/core/i18n';

import {
  METRIC_KEYS,
  contributionsApi,
  defaultFilter,
  formatNumber,
  type ContributionGroup,
  type ContributionMetricKey,
  type ContributionsFilterState,
  type OrgOption,
  type RepoOption,
} from '@/plugins/contributions/api';
import { ContributorDrawer } from '@/plugins/contributions/components/ContributorDrawer';
import { Leaderboard } from '@/plugins/contributions/components/Leaderboard';
import { MetricFilter } from '@/plugins/contributions/components/MetricFilter';

/** 贡献度看板：三维度 Tab + 五口径筛选 + 时间窗 + 汇总区 + 榜单 + 详情抽屉。 */
export function ContributionsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<ContributionsFilterState>(() => {
    const initial = defaultFilter();
    // 仓库详情页入口带 repo=<repo_id> 跳转：直接落在「仓库」维度并预选该仓库。
    const repoParam = searchParams.get('repo');
    if (repoParam) {
      return { ...initial, dimension: 'repo', scope: repoParam };
    }
    return initial;
  });
  const [selectedContributor, setSelectedContributor] = useState<string | null>(null);

  const groupBy = filter.dimension === 'repo' ? 'repo' : 'org';
  const rangeKey = `${filter.from}|${filter.to}`;

  const summary = useQuery({
    queryKey: queryKeys.contributionsSummary(
      groupBy,
      filter.metric,
      filter.scope && filter.dimension === 'org' ? filter.scope : null,
      filter.scope && filter.dimension === 'repo' ? filter.scope : null,
      rangeKey,
    ),
    queryFn: () =>
      contributionsApi.summary({
        groupBy,
        metric: filter.metric,
        org: filter.dimension === 'org' && filter.scope ? filter.scope : undefined,
        repo: filter.dimension === 'repo' && filter.scope ? filter.scope : undefined,
        from: filter.from,
        to: filter.to,
      }),
  });

  const leaderboard = useQuery({
    queryKey: queryKeys.contributionsLeaderboard(
      filter.dimension,
      filter.scope,
      filter.metric,
      rangeKey,
    ),
    queryFn: () =>
      contributionsApi.leaderboard({
        dimension: filter.dimension,
        scope: filter.scope ?? undefined,
        metric: filter.metric,
        from: filter.from,
        to: filter.to,
        limit: 50,
      }),
    enabled: filter.dimension === 'project' || filter.scope !== null,
  });

  const repos = useQuery({
    queryKey: queryKeys.repos(null),
    queryFn: () => reposApi.list(),
    enabled: filter.dimension === 'repo',
  });

  // 组织下拉选项：来自 summary group_by=org 的分组（org 维度时 summary 即按 org 分组）。
  const orgOptions: OrgOption[] =
    filter.dimension === 'repo'
      ? []
      : (summary.data?.groups ?? [])
          .filter((g) => g.kind === 'org')
          .map((g) => ({ key: g.key, name: g.name }));

  const repoOptions: RepoOption[] = (repos.data ?? []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
  }));

  // wiki 口径全 0 是正常态（OpenAN 各仓库 wiki 仓库不存在），显式呈现空态而非报错/空白。
  const wikiEmpty = filter.metric === 'wiki' && (summary.data?.totals.metric_value ?? 0) === 0;

  const scopeHintVisible = filter.dimension !== 'project' && filter.scope === null;

  return (
    <div>
      <PageHeader
        title={t('contributions.title')}
        description={t('contributions.description')}
      />

      <MetricFilter
        value={filter}
        orgOptions={orgOptions}
        repoOptions={repoOptions}
        onChange={setFilter}
      />

      {/* 汇总区 */}
      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--c-text)' }}>
          {t('contributions.summary.title')}
        </h2>
        {summary.isError ? (
          <EmptyState title={t('contributions.loadFailed')} />
        ) : wikiEmpty ? (
          <EmptyState
            title={t('contributions.empty.wiki')}
            description={t('contributions.empty.wikiHint')}
          />
        ) : summary.isLoading ? (
          <Card>
            <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
              {t('common.loading')}
            </p>
          </Card>
        ) : summary.data && summary.data.groups.length > 0 ? (
          <GroupGrid
            groups={summary.data.groups}
            metric={filter.metric}
            unit={summary.data.metric_meta.unit}
            onSelect={(key) => setFilter({ ...filter, scope: key })}
          />
        ) : (
          <EmptyState title={t('contributions.empty.groups')} />
        )}
      </section>

      {/* 榜单 */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--c-text)' }}>
            {t('contributions.leaderboard.title')}
          </h2>
          {leaderboard.data ? (
            <span className="text-xs" style={{ color: 'var(--c-text3)' }}>
              {leaderboard.data.total_contributors} {t('contributions.summary.contributors')}
            </span>
          ) : null}
        </div>

        {leaderboard.isError ? (
          <EmptyState title={t('contributions.loadFailed')} />
        ) : scopeHintVisible ? (
          <EmptyState title={t('contributions.leaderboard.scopeHint')} />
        ) : wikiEmpty ? (
          <EmptyState title={t('contributions.empty.wiki')} />
        ) : leaderboard.isLoading ? (
          <Card>
            <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
              {t('common.loading')}
            </p>
          </Card>
        ) : leaderboard.data && leaderboard.data.contributors.length > 0 ? (
          <Leaderboard
            contributors={leaderboard.data.contributors}
            metric={filter.metric}
            onSelect={setSelectedContributor}
          />
        ) : (
          <EmptyState title={t('contributions.leaderboard.noData')} />
        )}
      </section>

      <ContributorDrawer
        contributorId={selectedContributor}
        onClose={() => setSelectedContributor(null)}
      />
    </div>
  );
}

/** 汇总区：组织 / 仓库分组卡片，展示五口径数值 + 主口径高亮。 */
function GroupGrid({
  groups,
  metric,
  unit,
  onSelect,
}: {
  groups: ContributionGroup[];
  metric: ContributionMetricKey;
  unit: string;
  onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          onClick={() => onSelect(g.key)}
          className="rounded-lg border p-4 text-left"
          style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
                {g.name}
              </p>
              {g.full_name ? (
                <p className="truncate text-xs" style={{ color: 'var(--c-text3)' }}>
                  {g.full_name}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs" style={{ color: 'var(--c-text3)' }}>
              {g.contributor_count} {t('contributions.summary.contributors')}
            </span>
          </div>

          <div className="mt-3">
            <p className="text-xs" style={{ color: 'var(--c-text3)' }}>
              {t(`contributions.metric.${metric}`)}
            </p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--c-primary)' }}>
              {formatNumber(g.metric_value)}
              <span className="ml-1 text-sm font-normal" style={{ color: 'var(--c-text3)' }}>
                {unit}
              </span>
            </p>
          </div>

          <div className="mt-3 grid grid-cols-5 gap-1">
            {METRIC_KEYS.map((m) => (
              <div key={m} className="text-center">
                <p className="text-[10px]" style={{ color: 'var(--c-text3)' }}>
                  {t(`contributions.metric.${m}`)}
                </p>
                <p
                  className="text-xs font-medium tabular-nums"
                  style={{ color: m === metric ? 'var(--c-primary)' : 'var(--c-text2)' }}
                >
                  {formatNumber(m === 'code' ? g.metrics.code_total : g.metrics[m])}
                </p>
              </div>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}