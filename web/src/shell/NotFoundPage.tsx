import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

/** 未知路由兜底页（壳层所有，任何插件都不得覆盖）。 */
export function NotFoundPage({ homePath }: { homePath?: string | null }) {
  return (
    <div>
      <PageHeader title="404" description="页面不存在" />
      <EmptyState title="找不到该页面" description="请检查链接是否正确。">
        {homePath ? (
          <Link className="text-brand-700 hover:underline" to={homePath}>
            返回首页
          </Link>
        ) : null}
      </EmptyState>
    </div>
  );
}