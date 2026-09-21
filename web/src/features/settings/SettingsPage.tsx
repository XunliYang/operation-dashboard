import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';

/** 设置页（Phase 0 占位）。 */
export function SettingsPage() {
  const { t } = useI18n();

  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('common.placeholder')} />
      <Card title="配置">
        <p className="text-sm text-slate-600">
          追踪仓库、组织映射、健康权重与情感映射将由 <code className="rounded bg-slate-100 px-1">config/</code>{' '}
          下的 YAML 提供，Phase 1 起在此页编辑。
        </p>
      </Card>
    </div>
  );
}
