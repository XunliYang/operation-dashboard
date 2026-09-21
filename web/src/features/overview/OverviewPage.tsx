import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { HealthBarChart } from '@/components/charts/HealthBarChart';
import type { HealthBarDatum } from '@/components/charts/HealthBarChart';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { queryKeys } from '@/core/api/queryKeys';
import { reposApi } from '@/core/api/repos';
import { useI18n } from '@/core/i18n';

/** 总览：跨看板摘要 + 项目列表（带最新健康分）。 */
export function OverviewPage() {
  const { t } = useI18n();
  const repos = useQuery({ queryKey: queryKeys.repos(null), queryFn: () => reposApi.list() });

  const barData: HealthBarDatum[] = (repos.data ?? []).map((r) => ({
    name: r.full_name,
    score: r.health_score,
  }));

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">{t('overview.title')}</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="仓库健康分" description="各被监控项目最新综合健康分（0–100）">
          {repos.isLoading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : barData.length > 0 ? (
            <HealthBarChart data={barData} />
          ) : (
            <EmptyState title="暂无健康分数据" description="等待采集器写入事实数据。" />
          )}
        </Card>

        <Card title="快速入口">
          <ul className="space-y-2 text-sm">
            {repos.data?.map((r) => (
              <li key={r.id}>
                <Link className="text-brand-700 hover:underline" to={`/repos/${r.id}`}>
                  {r.full_name} →
                </Link>
              </li>
            ))}
            <li>
              <Link className="text-brand-700 hover:underline" to="/sentiment">
                {t('nav.sentiment')} →
              </Link>
            </li>
            <li>
              <Link className="text-brand-700 hover:underline" to="/settings">
                {t('nav.settings')} →
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}