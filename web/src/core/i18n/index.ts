/**
 * 极简 i18n：基础词典 + `registerMessages` 增量合并。不引入第三方库。
 *
 * 壳层只保留自身使用的基础词条（app / common / 健康检查 / 错误文案）；
 * 子模块词条经插件契约的 `registerMessages` 注册，约定 key 带 `<插件id>.` 前缀（如 `repos.title`）。
 * 缺键回退链：当前 locale → 中文 → key 本身。
 */
import { create } from 'zustand';

export type Locale = 'zh' | 'en';

/** 基础词典：壳层自身使用的词条。 */
const baseMessages = {
  zh: {
    'app.title': '运营看板',
    'common.loading': '加载中…',
    'common.placeholder': '本阶段为占位页，功能将在后续阶段接入。',
    'health.ok': '后端连接正常',
    'health.fail': '后端连接异常',
  },
  en: {
    'app.title': 'Operation Dashboard',
    'common.loading': 'Loading…',
    'common.placeholder': 'Placeholder page for this phase; wired up in a later phase.',
    'health.ok': 'API reachable',
    'health.fail': 'API unreachable',
  },
} as const satisfies Record<Locale, Record<string, string>>;

/** 合并后的运行时词表；插件经 `registerMessages` 增量写入。 */
const messages: Record<Locale, Record<string, string>> = {
  zh: { ...baseMessages.zh },
  en: { ...baseMessages.en },
};

/**
 * 增量合并插件词条。校验：每个 key 必须带 `<id>.` 前缀，避免不同插件词条互相冲突。
 */
export function registerMessages(
  id: string,
  tables: Partial<Record<Locale, Record<string, string>>>,
): void {
  if (!id) throw new Error('registerMessages 缺少插件 id');

  for (const locale of ['zh', 'en'] as const) {
    const table = tables[locale];
    if (!table) continue;
    for (const key of Object.keys(table)) {
      if (!key.startsWith(`${id}.`)) {
        throw new Error(`插件 "${id}" 的 i18n key "${key}" 必须以 "${id}." 开头`);
      }
      messages[locale][key] = table[key];
    }
  }
}

/** 词条 key 为任意字符串（插件词条运行时注册，无法静态收口）。 */
export type MessageKey = string;

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

/** 按当前 locale 取词；缺键回退中文再回退 key 本身。 */
export function translate(locale: Locale, key: string): string {
  const table = messages[locale] ?? messages.zh;
  return table[key] ?? messages.zh[key] ?? key;
}

export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const toggleLocale = useI18nStore((s) => s.toggleLocale);

  return {
    locale,
    setLocale,
    toggleLocale,
    t: (key: string) => translate(locale, key),
  };
}