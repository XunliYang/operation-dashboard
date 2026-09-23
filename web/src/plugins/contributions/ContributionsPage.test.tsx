import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMessages } from '@/core/i18n';

import type { ContributorDetail, ContributionsSummary, Leaderboard } from './api';
import { messages } from './i18n';
import { ContributionsPage } from './pages/ContributionsPage';

// 生产环境经 ctx.registerMessages 注册；测试直接注入同一份词表。
registerMessages('contributions', messages);

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data, request_id: 'r' }), {
    status: 200,
  });
}

function metrics(overrides: Record<string, number> = {}) {
  return {
    prs: 1,
    commits: 165,
    code_additions: 100,
    code_deletions: 50,
    code_total: 150,
    issues: 0,
    wiki: 0,
    ...overrides,
  };
}

const SUMMARY: ContributionsSummary = {
  group_by: 'org',
  metric: 'commits',
  range: { from: '2026-06-25', to: '2026-09-23' },
  metric_meta: { key: 'commits', label: 'Commit 数', unit: '个' },
  totals: { metric_value: 215, contributor_count: 4, group_count: 2 },
  groups: [
    {
      key: 'huawei',
      kind: 'org',
      name: '华为系',
      full_name: null,
      contributor_count: 2,
      metric_value: 165,
      metrics: metrics({ commits: 165 }),
    },
    {
      key: 'zte',
      kind: 'org',
      name: '中兴',
      full_name: null,
      contributor_count: 2,
      metric_value: 50,
      metrics: metrics({ commits: 50 }),
    },
  ],
};

const WIKI_SUMMARY: ContributionsSummary = {
  group_by: 'org',
  metric: 'wiki',
  range: { from: '2026-06-25', to: '2026-09-23' },
  metric_meta: { key: 'wiki', label: 'Wiki 修订', unit: '条' },
  totals: { metric_value: 0, contributor_count: 4, group_count: 2 },
  groups: [
    {
      key: 'huawei',
      kind: 'org',
      name: '华为系',
      full_name: null,
      contributor_count: 2,
      metric_value: 0,
      metrics: metrics({ commits: 1, code_total: 1, wiki: 0 }),
    },
  ],
};

const LEADERBOARD: Leaderboard = {
  dimension: 'project',
  scope: null,
  metric: 'commits',
  range: { from: '2026-06-25', to: '2026-09-23' },
  total_contributors: 2,
  contributors: [
    {
      rank: 1,
      contributor_id: '1',
      login: 'ivo.zhou',
      display_name: 'Ivo Zhou',
      avatar_url: 'https://github.com/ivo.zhou.png',
      email: 'ivo.zhou@huawei.com',
      email_masked: 'i***@huawei.com',
      org: { key: 'huawei', display: '华为系', source: 'manual_yaml', confidence: 1.0 },
      metrics: metrics({ commits: 165 }),
      metric_value: 165,
      first_seen_at: null,
      last_seen_at: null,
      repos: [{ id: '165', full_name: 'project-openan/registry-center', metric_value: 165 }],
    },
    {
      rank: 2,
      contributor_id: '2',
      login: 'zhoujie628',
      display_name: null,
      avatar_url: 'https://github.com/zhoujie628.png',
      email: null,
      email_masked: null,
      org: { key: 'zte', display: '中兴', source: 'manual_yaml', confidence: 0.8 },
      metrics: metrics({ commits: 50 }),
      metric_value: 50,
      first_seen_at: null,
      last_seen_at: null,
      repos: [],
    },
  ],
};

const DETAIL: ContributorDetail = {
  id: '1',
  login: 'ivo.zhou',
  display_name: 'Ivo Zhou',
  email: 'ivo.zhou@huawei.com',
  email_masked: 'i***@huawei.com',
  company: 'Huawei',
  first_seen_at: '2026-01-01T00:00:00Z',
  last_seen_at: '2026-09-19T00:00:00Z',
  orgs: [{ org_id: '1', name: '华为系', kind: 'org', role: 'maintainer', confidence: 1.0, source: 'manual_yaml' }],
  repos: [{ id: '165', full_name: 'project-openan/registry-center' }],
  activity: { commits: 165, prs: 1, reviews: 0 },
  contributions: {
    metrics: metrics(),
    by_org: [
      { org_id: '1', key: 'huawei', name: '华为系', metrics: metrics() },
    ],
    by_repo: [
      { id: '165', full_name: 'project-openan/registry-center', metrics: metrics() },
    ],
  },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contributions']}>
        <ContributionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContributionsPage', () => {
  it('默认时间窗为最近 90 天：summary 请求携带 from/to', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => envelope(SUMMARY));
    globalThis.fetch = fetchMock;

    renderPage();
    await screen.findByText('贡献度汇总');

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const summaryUrl = urls.find((u) => u.includes('/contributions/summary'));
    expect(summaryUrl).toBeDefined();
    expect(summaryUrl).toContain('group_by=org');
    expect(summaryUrl).toContain('from=');
    expect(summaryUrl).toContain('to=');
  });

  it('组织维度展示组织分组，且不出现 huawei-partner 分组', async () => {
    globalThis.fetch = vi.fn(async () => envelope(SUMMARY)) as typeof fetch;

    renderPage();

    expect((await screen.findAllByText('华为系')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('中兴').length).toBeGreaterThan(0);
    expect(screen.queryByText('huawei-partner')).not.toBeInTheDocument();
  });

  it('整个项目维度榜单展示 rank/头像/@login/明文邮箱/组织', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contributions/leaderboard')) return envelope(LEADERBOARD);
      return envelope(SUMMARY);
    }) as typeof fetch;

    renderPage();
    await screen.findByText('贡献度汇总');

    fireEvent.click(screen.getByRole('button', { name: '整个项目' }));

    expect(await screen.findByText('@ivo.zhou')).toBeInTheDocument();
    expect(screen.getByText('ivo.zhou@huawei.com')).toBeInTheDocument();
    // 组织标签 + 主口径数值（165 提交）可见
    expect(screen.getAllByText('华为系').length).toBeGreaterThan(0);
    expect(screen.getAllByText('165').length).toBeGreaterThan(0);
  });

  it('点击榜单行打开贡献详情抽屉', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/dashboard/contributors/')) return envelope(DETAIL);
      if (url.includes('/contributions/leaderboard')) return envelope(LEADERBOARD);
      return envelope(SUMMARY);
    }) as typeof fetch;

    renderPage();
    await screen.findByText('贡献度汇总');
    fireEvent.click(screen.getByRole('button', { name: '整个项目' }));

    const row = await screen.findByText('@ivo.zhou');
    fireEvent.click(row.closest('tr') as HTMLTableRowElement);

    expect(await screen.findByText('贡献详情')).toBeInTheDocument();
    expect(await screen.findByText('project-openan/registry-center')).toBeInTheDocument();
    expect((await screen.findAllByText('ivo.zhou@huawei.com')).length).toBeGreaterThan(0);
  });

  it('wiki 口径全 0 时显示明确空态文案', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('metric=wiki')) return envelope(WIKI_SUMMARY);
      return envelope(SUMMARY);
    }) as typeof fetch;

    renderPage();
    await screen.findByText('贡献度汇总');

    fireEvent.change(screen.getByLabelText('口径'), { target: { value: 'wiki' } });

    expect(await screen.findByText('当前无 wiki 内容')).toBeInTheDocument();
  });
});