import { useParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';

/** 仓库详情：验证 `/repos/:id` 动态路由参数解析。 */
export function RepoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();

  return (
    <div>
      <PageHeader title={`${t('repos.title')} · ${id ?? 'unknown'}`} description={t('common.placeholder')} />
      <Card title="指标">
        <EmptyState title={`仓库 ${id ?? 'unknown'} 的指标待接入`} description="Phase 1 接入后展示提交、Issue、PR 与健康分。" />
      </Card>
    </div>
  );
}
