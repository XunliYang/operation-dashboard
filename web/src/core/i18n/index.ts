/**
 * 极简 i18n：字典 + `useI18n` hook。Phase 0 只需中英两套键，不引入第三方库。
 * 后续若需复数/日期格式化再换 react-i18next，调用点无需改动。
 */
import { create } from 'zustand';

export type Locale = 'zh' | 'en';

const dictionaries = {
  zh: {
    'app.title': '运营看板',
    'nav.overview': '总览',
    'nav.repos': '仓库',
    'nav.people': '成员',
    'nav.sentiment': '舆情',
    'nav.settings': '设置',
    'common.loading': '加载中…',
    'common.placeholder': '本阶段为占位页，功能将在后续阶段接入。',
    'health.ok': '后端连接正常',
    'health.fail': '后端连接异常',
    'overview.title': '总览',
    'repos.title': '仓库',
    'people.title': '成员',
    'sentiment.title': '舆情',
    'settings.title': '设置',
  },
  en: {
    'app.title': 'Operation Dashboard',
    'nav.overview': 'Overview',
    'nav.repos': 'Repos',
    'nav.people': 'People',
    'nav.sentiment': 'Sentiment',
    'nav.settings': 'Settings',
    'common.loading': 'Loading…',
    'common.placeholder': 'Placeholder page for this phase; wired up in a later phase.',
    'health.ok': 'API reachable',
    'health.fail': 'API unreachable',
    'overview.title': 'Overview',
    'repos.title': 'Repos',
    'people.title': 'People',
    'sentiment.title': 'Sentiment',
    'settings.title': 'Settings',
  },
} as const;

export type MessageKey = keyof (typeof dictionaries)['zh'];

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: 'zh',
  setLocale: (locale) => set({ locale }),
  toggleLocale: () => set((s) => ({ locale: s.locale === 'zh' ? 'en' : 'zh' })),
}));

/** 按当前 locale 取词；缺键时回退到中文再回退到 key 本身。 */
export function translate(locale: Locale, key: MessageKey): string {
  const table = dictionaries[locale] ?? dictionaries.zh;
  return table[key] ?? dictionaries.zh[key] ?? key;
}

export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const toggleLocale = useI18nStore((s) => s.toggleLocale);

  return {
    locale,
    setLocale,
    toggleLocale,
    t: (key: MessageKey) => translate(locale, key),
  };
}
