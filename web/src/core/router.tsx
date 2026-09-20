import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { NotFoundPage } from '@/features/overview/NotFoundPage';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { PeoplePage } from '@/features/people/PeoplePage';
import { RepoDetailPage } from '@/features/repos/RepoDetailPage';
import { ReposPage } from '@/features/repos/ReposPage';
import { SentimentPage } from '@/features/sentiment/SentimentPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

/**
 * 路由表：`/` 重定向到 `/overview`。
 * 部署时由 nginx `try_files ... /index.html` 提供 SPA fallback，
 * 保证深层链接刷新不 404。
 */
export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'repos', element: <ReposPage /> },
      { path: 'repos/:id', element: <RepoDetailPage /> },
      { path: 'people', element: <PeoplePage /> },
      { path: 'sentiment', element: <SentimentPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
