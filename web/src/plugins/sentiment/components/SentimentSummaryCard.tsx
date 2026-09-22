import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { useI18n } from '@/core/i18n';
import { MetricCard } from '@/shell/MetricCard';

import { SENTIMENT_REPO, sentimentApi } from '@/plugins/sentiment/api';

/** `overview.card` 插槽 · 舆情聚合摘要卡（含降级态）。 */
export function SentimentSummaryCard() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['sentiment', 'summary', SENTIMENT_REPO],
    queryFn: () => sentimentApi.summary(),
    staleTime: 30_000,
  });

  const degraded = query.data?.degraded === true || query.isError;
  const summary = query.data?.summary ?? null;

  if (query.isLoading) {
    return (
      <Card title={t('sentiment.title')} description={t('sentiment.description')}>
        <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
          {t('common.loading')}
        </p>
      </Card>
    );
  }

  return (
    <Card title={t('sentiment.title')} description={t('sentiment.description')}>
      {degraded ? (
        <div
          className="rounded-lg border border-dashed p-4 text-center"
          style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--c-text2)' }}>
            {t('sentiment.degraded')}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--c-text3)' }}>
            {t('sentiment.degraded.description')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label={t('sentiment.summary.total')} value={summary?.total ?? '—'} />
          <MetricCard label={t('sentiment.summary.positive')} value={summary?.distribution.positive ?? '—'} />
          <MetricCard label={t('sentiment.summary.negative')} value={summary?.distribution.negative ?? '—'} />
          <MetricCard
            label={t('sentiment.summary.score')}
            value={summary != null ? summary.score.toFixed(2) : '—'}
          />
        </div>
      )}
    </Card>
  );
}