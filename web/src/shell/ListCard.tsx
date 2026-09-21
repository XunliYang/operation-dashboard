import { Link } from 'react-router-dom';

export interface ListCardItem {
  /** 优先级标签（可选）。 */
  priority?: string;
  /** 标题，单行省略。 */
  title: string;
  /** 点击目标（内部路由），提供后整行可点击跳转。 */
  to?: string;
  onClick?: () => void;
}

export interface ListCardProps {
  title: string;
  /** 条目数计数徽标（可选）。 */
  count?: number;
  items: ListCardItem[];
}

/** 壳层通用列表卡：标题含计数徽标 + 分隔行列表；每行 = [优先级 tag] 标题，整行可点。 */
export function ListCard({ title, count, items }: ListCardProps) {
  return (
    <div
      className="rounded-lg border"
      style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--c-border2)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{title}</h2>
        {typeof count === 'number' ? (
          <span
            className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium"
            style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
          >
            {count}
          </span>
        ) : null}
      </div>

      <ul>
        {items.map((item, index) => {
          const inner = (
            <>
              {item.priority ? (
                <span
                  className="mr-2 inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{ background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }}
                >
                  {item.priority}
                </span>
              ) : null}
              <span className="truncate">{item.title}</span>
            </>
          );
          const rowClass = 'flex w-full items-center px-4 py-3 text-sm';

          return (
            <li
              key={item.title + String(index)}
              style={index > 0 ? { borderTop: '1px solid var(--c-border2)' } : undefined}
            >
              {item.to ? (
                <Link to={item.to} className={`${rowClass} no-underline`} style={{ color: 'var(--c-text)' }}>
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  className={`${rowClass} text-left`}
                  style={{ color: 'var(--c-text)' }}
                  onClick={item.onClick}
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}