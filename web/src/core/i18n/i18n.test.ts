import { describe, expect, it } from 'vitest';

import { translate, useI18nStore } from '@/core/i18n';

describe('i18n', () => {
  it('翻译中英文键', () => {
    expect(translate('zh', 'nav.overview')).toBe('总览');
    expect(translate('en', 'nav.overview')).toBe('Overview');
  });

  it('缺少键时回退到 key 本身', () => {
    // @ts-expect-error 故意传入非法键，验证回退
    expect(translate('en', 'nope.missing')).toBe('nope.missing');
  });

  it('toggleLocale 在中英之间切换', () => {
    useI18nStore.setState({ locale: 'zh' });
    useI18nStore.getState().toggleLocale();
    expect(useI18nStore.getState().locale).toBe('en');
    useI18nStore.getState().toggleLocale();
    expect(useI18nStore.getState().locale).toBe('zh');
  });
});
