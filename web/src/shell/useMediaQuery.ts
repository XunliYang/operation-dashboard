import { useCallback, useSyncExternalStore } from 'react';

/**
 * 壳层移动端断点：与 `theme.css` 中 `@media (max-width: 767px)` 保持一致（Tailwind `md` = 768px，
 * `<md` 即 767px 及以下）。顶栏收纳、抽屉与窄屏工具区精简都以此为界，插件不得自行感知断点。
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

function queryMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** 订阅一个媒体查询；jsdom 等无 `matchMedia` 的环境回退为 false（桌面）。 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(subscribe, () => queryMatches(query), () => false);
}

/** 窄屏（<md，即 ≤767px）判断，驱动壳层顶栏的抽屉收纳。 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}