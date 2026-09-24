import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      name: '华为',
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
      name: '华为',
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
      org: { key: 'huawei', display: '华为', source: 'manual_yaml', confidence: 1.0 },
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

// wiki 口径下后端仍返回 total_contributors 与非空 contributors（wiki 数值全 0），
// 用于复现「头部计数与空态并存」的缺陷：头部计数应在空态时一并隐藏。
const WIKI_LEADERBOARD: Leaderboard = {
  ...LEADERBOARD,
  metric: 'wiki',
  total_contributors: 14,
  contributors: LEADERBOARD.contributors.map((c) => ({
    ...c,
    metric_value: 0,
    metrics: metrics({ prs: 0, commits: 0, code_total: 0, issues: 0, wiki: 0 }),
  })),
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
  orgs: [{ org_id: '1', name: '华为', kind: 'org', role: 'maintainer', confidence: 1.0, source: 'manual_yaml' }],
  repos: [{ id: '165', full_name: 'project-openan/registry-center' }],
  activity: { commits: 165, prs: 1, reviews: 0 },
  contributions: {
    metrics: metrics(),
    by_org: [
      { org_id: '1', key: 'huawei', name: '华为', metrics: metrics() },
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

    expect((await screen.findAllByText('华为')).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('华为').length).toBeGreaterThan(0);
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

  it('wiki 口径全 0 时显示明确空态文案，且榜单头部不显示贡献者计数', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contributions/leaderboard')) {
        return url.includes('metric=wiki') ? envelope(WIKI_LEADERBOARD) : envelope(LEADERBOARD);
      }
      if (url.includes('metric=wiki')) return envelope(WIKI_SUMMARY);
      return envelope(SUMMARY);
    }) as typeof fetch;

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/contributions']}>
          <ContributionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('贡献度汇总');

    // 先等组织下拉就绪（否则受控 select 尚无该 option，change 不会生效），
    // 再选组织 scope 使榜单启用，最后切 wiki 口径触发空态（复现 issue 场景：org + wiki）。
    await screen.findByRole('option', { name: '华为' });
    fireEvent.change(screen.getByLabelText('选择组织'), { target: { value: 'huawei' } });
    fireEvent.change(screen.getByLabelText('口径'), { target: { value: 'wiki' } });

    expect((await screen.findAllByText('当前无 wiki 内容')).length).toBeGreaterThan(0);

    // 等所有查询（含 wiki 榜单）结算后，再断言头部计数：空态下「14 贡献者」应随计数一并隐藏。
    await waitFor(() => {
      expect(qc.isFetching()).toBe(0);
    });
    expect(screen.queryByText('14 贡献者')).not.toBeInTheDocument();
  });

  it('组织维度选中 scope 后，下拉仍列出全部组织（P1 回归）', async () => {
    const filteredSummary: ContributionsSummary = { ...SUMMARY, groups: [SUMMARY.groups[0]] };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contributions/leaderboard')) return envelope(LEADERBOARD);
      if (url.includes('org=huawei')) return envelope(filteredSummary);
      return envelope(SUMMARY);
    }) as typeof fetch;

    renderPage();
    await screen.findByText('贡献度汇总');

    // 选中 huawei → summary filtered 只剩华为，但 scope 下拉应仍来自独立 orgList
    fireEvent.change(screen.getByLabelText('选择组织'), { target: { value: 'huawei' } });

    expect(await screen.findByRole('option', { name: '中兴' })).toBeInTheDocument();
  });

  it('login 为 null 的榜单行不渲染坏头像/坏外链（P2-3 回归）', async () => {
    const nullLoginBoard: Leaderboard = {
      ...LEADERBOARD,
      contributors: [
        {
          rank: 1,
          contributor_id: '99',
          login: null,
          display_name: null,
          avatar_url: null,
          email: null,
          email_masked: null,
          org: { key: '_unclassified', display: '待归类', source: 'inferred', confidence: null },
          metrics: metrics({ commits: 3 }),
          metric_value: 3,
          first_seen_at: null,
          last_seen_at: null,
          repos: [],
        },
      ],
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contributions/leaderboard')) return envelope(nullLoginBoard);
      return envelope(SUMMARY);
    }) as typeof fetch;

    renderPage();
    await screen.findByText('贡献度汇总');
    fireEvent.click(screen.getByRole('button', { name: '整个项目' }));

    // 无 login：显示纯文本 #99，不渲染坏外链（href 含 #99）
    expect(await screen.findByText('#99')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '#99' })).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="#99"]')).not.toBeInTheDocument();
  });
});