import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';

/** 仓库列表（Phase 0 骨架，数据待 Phase 1 接入 `GET /rest/v1/repos`）。 */
export function ReposPage() {
  const { t } = useI18n();

  return (
    <div>
      <PageHeader title={t('repos.title')} description={t('common.placeholder')} />
      <Card title="仓库">
        <ul className="space-y-2 text-sm">
          <li>
            <Link className="text-brand-700 hover:underline" to="/repos/operation-dashboard">
              operation-dashboard
            </Link>
          </li>
          <li>
            <Link className="text-brand-700 hover:underline" to="/repos/sentiment-monitor">
              sentiment-monitor
            </Link>
          </li>
        </ul>
      </Card>
    </div>
  );
}
