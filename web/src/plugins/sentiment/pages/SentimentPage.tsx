import { useQuery } from '@tanstack/react-query';

import { SentimentTrendChart } from '@/components/charts/SentimentTrendChart';
import type { SentimentPoint } from '@/components/charts/SentimentTrendChart';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useI18n } from '@/core/i18n';

import { SENTIMENT_REPO, sentimentApi } from '@/plugins/sentiment/api';

/** 看板 C · 舆情入口页：BFF 聚合摘要 + 情感走势（降级态见 §6）。 */
export function SentimentPage() {
  const { t } = useI18n();

  const summaryQuery = useQuery({
    queryKey: ['sentiment', 'summary', SENTIMENT_REPO],
    queryFn: () => sentimentApi.summary(),
    staleTime: 30_000,
  });
  const timeseriesQuery = useQuery({
    queryKey: ['sentiment', 'timeseries', SENTIMENT_REPO],
    queryFn: () => sentimentApi.timeseries(),
    staleTime: 30_000,
  });

  const degraded =
    (summaryQuery.data?.degraded === true || summaryQuery.isError) &&
    (timeseriesQuery.data?.degraded === true || timeseriesQuery.isError);

  const summary = summaryQuery.data?.summary ?? null;
  const points: SentimentPoint[] = (timeseriesQuery.data?.series ?? []).map((p) => ({
    date: p.date.slice(5),
    score: p.score,
  }));

  if (summaryQuery.isLoading && timeseriesQuery.isLoading) {
    return (
      <div>
        <PageHeader title={t('sentiment.title')} description={t('sentiment.description')} />
        <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
          {t('common.loading')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('sentiment.title')} description={t('sentiment.description')} />

      {degraded ? (
        <div
          className="rounded-lg border border-dashed p-6 text-center"
          style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--c-text2)' }}>
            {t('sentiment.degraded')}
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--c-text3)' }}>
            {t('sentiment.degraded.description')}
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card title={t('sentiment.summary.score')} description={t('sentiment.description')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-4" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
                <p className="text-xs" style={{ color: 'var(--c-text3)' }}>{t('sentiment.summary.total')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
                  {summary?.total ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
                <p className="text-xs" style={{ color: 'var(--c-text3)' }}>{t('sentiment.summary.positive')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
                  {summary?.distribution.positive ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
                <p className="text-xs" style={{ color: 'var(--c-text3)' }}>{t('sentiment.summary.negative')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
                  {summary?.distribution.negative ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border p-4" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
                <p className="text-xs" style={{ color: 'var(--c-text3)' }}>{t('sentiment.summary.score')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--c-text)' }}>
                  {summary != null ? summary.score.toFixed(2) : '—'}
                </p>
              </div>
            </div>
            {summary?.spike_detected ? (
              <p className="mt-3 text-sm font-medium" style={{ color: 'var(--c-danger, #ef4444)' }}>
                ⚠ {t('sentiment.spike')}
              </p>
            ) : null}
          </Card>

          <Card title={t('sentiment.trend.title')} description={t('sentiment.trend.description')}>
            {points.length > 0 ? (
              <SentimentTrendChart data={points} />
            ) : (
              <p className="text-sm" style={{ color: 'var(--c-text3)' }}>
                {t('common.loading')}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}