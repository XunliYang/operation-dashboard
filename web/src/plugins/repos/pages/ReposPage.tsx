import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { queryKeys } from '@/core/api/queryKeys';
import { reposApi } from '@/core/api/repos';
import { useI18n } from '@/core/i18n';

function tone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 60) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}

/** 仓库列表：从 `GET /rest/v1/dashboard/repos` 拉取的被监控项目。 */
export function ReposPage() {
  const { t } = useI18n();
  const repos = useQuery({ queryKey: queryKeys.repos(null), queryFn: () => reposApi.list() });

  return (
    <div>
      <PageHeader title={t('repos.title')} description={t('common.placeholder')} />
      {repos.isError ? (
        <EmptyState title="加载仓库列表失败" description="请确认后端服务已就绪。" />
      ) : repos.isLoading ? (
        <Card>
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        </Card>
      ) : repos.data && repos.data.length > 0 ? (
        <Card title="仓库">
          <ul className="divide-y divide-slate-100">
            {repos.data.map((repo) => (
              <li key={repo.id} className="flex items-center justify-between py-3">
                <Link
                  className="text-sm font-medium text-brand-700 hover:underline"
                  to={`/repos/${repo.id}`}
                >
                  {repo.full_name}
                </Link>
                <div className="flex items-center gap-3">
                  <Badge tone={tone(repo.health_score)}>健康分 {repo.health_score}</Badge>
                  <span className="text-xs text-slate-500">
                    ★ {repo.stars} · Issues {repo.open_issues} · PR {repo.open_prs}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState title="暂无可追踪仓库" description="请在 config/tracked_repos.yaml 配置。" />
      )}
    </div>
  );
}