import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMessages } from '@/core/i18n';

import { messages } from './i18n';
import { SentimentPage } from './pages/SentimentPage';

registerMessages('sentiment', messages);

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data, request_id: 'r' }), {
    status: 200,
  });
}

const SUMMARY = {
  degraded: false,
  summary: {
    total: 4,
    distribution: { positive: 2, neutral: 1, negative: 1 },
    ratio: { positive: 0.5, neutral: 0.25, negative: 0.25 },
    score: 0.25,
    platforms: [{ source: 'weibo', count: 3 }],
    spike_detected: false,
    last_updated: '2026-09-16T12:00:00.000Z',
  },
  reason: null,
};

const SERIES = {
  degraded: false,
  series: [
    { date: '2026-09-16', total: 4, positive: 2, neutral: 1, negative: 1, score: 0.25 },
  ],
  reason: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SentimentPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SentimentPage', () => {
  it('渲染舆情聚合摘要与情感走势', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/timeseries')) return envelope(SERIES);
      return envelope(SUMMARY);
    }) as typeof fetch;

    renderPage();

    expect(await screen.findByText('舆情')).toBeInTheDocument();
    expect(await screen.findByText('0.25')).toBeInTheDocument();
    expect(screen.getByText('情感走势')).toBeInTheDocument();
  });

  it('舆情不可用时展示降级态「数据陈旧」而非崩溃', async () => {
    globalThis.fetch = vi.fn(async () =>
      envelope({ degraded: true, summary: null, reason: 'sentiment unavailable' }),
    ) as typeof fetch;

    renderPage();

    expect(await screen.findByText('数据陈旧')).toBeInTheDocument();
  });
});