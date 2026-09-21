import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMessages } from '@/core/i18n';

import type { OrgBoard } from './api';
import { messages } from './i18n';
import { PeoplePage } from './pages/PeoplePage';

// 生产环境经 ctx.registerMessages 注册；测试直接注入同一份词表。
registerMessages('people', messages);

const board: OrgBoard = {
  summary: {
    total_contributors: 3,
    total_orgs: 1,
    unclassified_count: 1,
    tiers: { core: 1, active: 1, occasional: 1, churned: 0 },
    alerts: [{ id: 2, days_inactive: 45, login: 'bob', org_id: '1' }],
  },
  orgs: [
    {
      id: '1',
      name: 'OpenAN',
      kind: 'org',
      source: 'manual_yaml',
      member_count: 2,
      contribution_share: 0.8,
      members: [
        {
          id: '1',
          login: 'alice',
          email_masked: 'a***@openan.org',
          org_id: '1',
          role: 'maintainer',
          confidence: 1.0,
          source: 'manual_yaml',
          contributions: 100,
          contribution_share: 0.5,
          tier: 'core',
          days_inactive: 2,
        },
        {
          id: '2',
          login: 'bob',
          email_masked: 'b***@openan.org',
          org_id: '1',
          role: 'maintainer',
          confidence: 0.8,
          source: 'api',
          contributions: 60,
          contribution_share: 0.3,
          tier: 'active',
          days_inactive: 45,
        },
      ],
      teams: [],
    },
  ],
  unclassified: [
    {
      id: '3',
      login: 'carol',
      email_masked: null,
      org_id: null,
      role: null,
      confidence: 0.0,
      source: 'inferred',
      contributions: 0,
      contribution_share: 0,
      tier: 'active',
      days_inactive: null,
    },
  ],
};

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data, request_id: 'r' }), {
    status: 200,
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeoplePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PeoplePage', () => {
  it('渲染组织树、活跃度分层、停滞告警与待归类', async () => {
    globalThis.fetch = vi.fn(async () => envelope(board)) as typeof fetch;

    renderPage();

    expect(await screen.findByText('OpenAN')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    // 停滞告警卡（关键维护者停滞）
    expect(screen.getByText('关键维护者停滞')).toBeInTheDocument();
    // 待归类显式呈现
    expect(screen.getByText('待归类成员')).toBeInTheDocument();
    // 活跃度分层标签
    expect(screen.getAllByText('核心').length).toBeGreaterThan(0);
    expect(screen.getAllByText('活跃').length).toBeGreaterThan(0);
  });

  it('点击成员打开画像抽屉并展示脱敏邮箱', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/dashboard/contributors/')) {
        return envelope({
          id: '1',
          login: 'alice',
          display_name: 'Alice',
          email: 'a***@openan.org',
          company: 'OpenAN',
          first_seen_at: '2026-01-01T00:00:00Z',
          last_seen_at: '2026-09-19T00:00:00Z',
          orgs: [{ org_id: '1', name: 'OpenAN', kind: 'org', role: 'maintainer', confidence: 1.0, source: 'manual_yaml' }],
          repos: [{ id: '1', full_name: 'project-openan/registry-center' }],
          activity: { commits: 10, prs: 3, reviews: 5 },
        });
      }
      return envelope(board);
    }) as typeof fetch;

    renderPage();
    const alice = await screen.findByText('@alice');
    fireEvent.click(alice.closest('button') as HTMLButtonElement);

    expect(await screen.findByText('a***@openan.org')).toBeInTheDocument();
    expect(screen.getByText('project-openan/registry-center')).toBeInTheDocument();
  });
});