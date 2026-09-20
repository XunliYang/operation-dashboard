import { useQuery } from '@tanstack/react-query';

import { api } from '@/core/api';
import { queryKeys } from '@/core/api/queryKeys';
import { useI18n } from '@/core/i18n';

import { Badge } from '@/components/ui/Badge';

/** 顶栏后端连通性指示器，走 `GET /rest/v1/healthz`。 */
export function HealthIndicator() {
  const { t } = useI18n();
  const { data, isError, isLoading } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.healthz,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <Badge tone="neutral">{t('common.loading')}</Badge>;
  }

  if (isError || !data) {
    return <Badge tone="danger">{t('health.fail')}</Badge>;
  }

  return <Badge tone="success">{t('health.ok')}</Badge>;
}
