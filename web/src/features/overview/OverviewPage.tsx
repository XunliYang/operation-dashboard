import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { HealthBarChart } from '@/components/charts/HealthBarChart';
import type { HealthBarDatum } from '@/components/charts/HealthBarChart';
import { useI18n } from '@/core/i18n';

// Phase 0 占位数据：验证图表与布局链路；Phase 1 接入 `/rest/v1/repos`。
const PLACEHOLDER: HealthBarDatum[] = [
  { name: 'operation-dashboard', score: 86 },
  { name: 'sentiment-monitor', score: 72 },
  { name: 'docs', score: 94 },
];

export function OverviewPage() {
  const { t } = useI18n();

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">{t('overview.title')}</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="仓库健康分" description="占位数据，Phase 1 接入真实指标">
          <HealthBarChart data={PLACEHOLDER} />
        </Card>

        <Card title="快速入口">
          <ul className="space-y-2 text-sm">
            <li>
              <Link className="text-brand-700 hover:underline" to="/repos">
                {t('nav.repos')} →
              </Link>
            </li>
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

      <div className="mt-4">
        <EmptyState title="更多卡片待接入" description={t('common.placeholder')} />
      </div>
    </div>
  );
}
