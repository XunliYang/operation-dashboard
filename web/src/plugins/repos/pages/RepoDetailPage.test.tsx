import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepoDetailPage } from './RepoDetailPage';

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data, request_id: 'r' }), {
    status: 200,
  });
}

const DETAIL = {
  id: '1',
  owner: 'project-openan',
  name: 'registry-center',
  full_name: 'project-openan/registry-center',
  default_branch: 'main',
  archived: false,
  health: {
    score: 85,
    dimensions: [
      { key: 'velocity', label: '开发速度', weight: 1, score: 80, indicators: [] },
    ],
  },
  key_metrics: {
    commits_30d: 10,
    active_contributors_30d: 3,
    prs_merged_30d: 2,
    issues_closed_30d: 1,
    stars: 5,
    forks: 2,
    open_issues: 0,
    open_prs: 1,
  },
};

const HEALTH_SERIES = {
  repo_id: '1',
  granularity: 'day',
  window_days: 30,
  series: [{ date: '2026-09-21', score: 85, dimensions: [] }],
  latest: DETAIL.health,
};

const COMMITS_SERIES = {
  metric: 'commits',
  series: [{ date: '2026-09-21', value: 10 }],
};

function renderPage(id = '1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/repos/${id}`]}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function notFoundResponse() {
  return new Response(JSON.stringify({ code: 40400, message: 'repo not found: 999' }), {
    status: 404,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RepoDetailPage', () => {
  it('页头主标题展示仓库名而非裸 repoId', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) return envelope(HEALTH_SERIES);
      if (url.includes('/metrics/')) return envelope(COMMITS_SERIES);
      return envelope(DETAIL);
    }) as typeof fetch;

    renderPage();

    // 主标题为仓库名，副标题为 owner/name。
    const heading = await screen.findByRole('heading', { level: 1, name: 'registry-center' });
    expect(heading).not.toHaveTextContent('1');
    expect(screen.getByText('project-openan/registry-center')).toBeInTheDocument();
  });

  it('错误路径下页头标题回退 repoId，不停留「加载中…」', async () => {
    globalThis.fetch = vi.fn(async () => notFoundResponse()) as typeof fetch;

    renderPage('999');

    // 主体渲染错误空态。
    const errorState = await screen.findByText('加载仓库数据失败');
    expect(errorState).toBeInTheDocument();

    // 页头标题回退为 repoId，且不出现加载占位文案。
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('999');
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
  });
});
