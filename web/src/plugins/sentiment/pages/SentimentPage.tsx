import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SentimentTrendChart } from '@/components/charts/SentimentTrendChart';
import type { SentimentPoint } from '@/components/charts/SentimentTrendChart';
import { useI18n } from '@/core/i18n';

// Phase 0 占位：Phase 3 接入 sentiment-monitor 的 SSE/轮询接口。
const PLACEHOLDER: SentimentPoint[] = [
  { date: '09-14', score: 0.12 },
  { date: '09-15', score: -0.05 },
  { date: '09-16', score: 0.31 },
  { date: '09-17', score: 0.44 },
  { date: '09-18', score: 0.2 },
  { date: '09-19', score: 0.55 },
  { date: '09-20', score: 0.4 },
];

/** 舆情页（Phase 0 占位，含图表骨架）。 */
export function SentimentPage() {
  const { t } = useI18n();

  return (
    <div>
      <PageHeader title={t('sentiment.title')} description={t('common.placeholder')} />
      <Card title="情感走势" description="占位数据，Phase 3 接入真实舆情数据">
        <SentimentTrendChart data={PLACEHOLDER} />
      </Card>
    </div>
  );
}
