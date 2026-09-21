import { describe, expect, it } from 'vitest';

import { registerMessages, translate, useI18nStore } from '@/core/i18n';

describe('i18n', () => {
  it('翻译基础词条（中英）', () => {
    expect(translate('zh', 'app.title')).toBe('运营看板');
    expect(translate('en', 'app.title')).toBe('Operation Dashboard');
  });

  it('缺少键时回退到 key 本身', () => {
    expect(translate('en', 'nope.missing')).toBe('nope.missing');
  });

  it('registerMessages 增量合并，且 key 必须带插件前缀', () => {
    registerMessages('repos', { zh: { 'repos.title': '仓库' }, en: { 'repos.title': 'Repos' } });
    expect(translate('zh', 'repos.title')).toBe('仓库');
    expect(translate('en', 'repos.title')).toBe('Repos');

    expect(() => registerMessages('repos', { zh: { title: 'bad' } })).toThrow(/repos\./);
  });

  it('toggleLocale 在中英之间切换', () => {
    useI18nStore.setState({ locale: 'zh' });
    useI18nStore.getState().toggleLocale();
    expect(useI18nStore.getState().locale).toBe('en');
    useI18nStore.getState().toggleLocale();
    expect(useI18nStore.getState().locale).toBe('zh');
  });
});