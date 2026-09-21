import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';

/** 成员页（Phase 0 占位）。 */
export function PeoplePage() {
  const { t } = useI18n();

  return (
    <div>
      <PageHeader title={t('people.title')} description={t('common.placeholder')} />
      <EmptyState title="成员数据待接入" description="Phase 2 接入成员贡献与协作指标。" />
    </div>
  );
}
