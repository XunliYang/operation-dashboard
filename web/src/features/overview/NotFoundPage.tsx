import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export function NotFoundPage() {
  return (
    <div>
      <PageHeader title="404" description="页面不存在" />
      <EmptyState title="找不到该页面" description="请检查链接是否正确。">
        <Link className="text-brand-700 hover:underline" to="/overview">
          返回总览
        </Link>
      </EmptyState>
    </div>
  );
}
