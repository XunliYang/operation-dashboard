import { describe, expect, it } from 'vitest';

import { RegistryValidationError, validateAndSort } from '@/shell/registry';

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    order: 10,
    titleKey: 'demo.title',
    register() {},
    ...overrides,
  };
}

describe('registry', () => {
  it('空插件集不崩，返回空数组', () => {
    expect(validateAndSort({})).toEqual([]);
  });

  it('按 order 升序排序', () => {
    const list = validateAndSort({
      'b.ts': { default: plugin({ id: 'b', order: 20 }) },
      'a.ts': { default: plugin({ id: 'a', order: 10 }) },
    });
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('插件缺 titleKey 被校验拦截', () => {
    expect(() =>
      validateAndSort({ 'x.ts': { default: plugin({ titleKey: '   ' }) } }),
    ).toThrow(RegistryValidationError);
  });

  it('插件 id 重复被拦截', () => {
    expect(() =>
      validateAndSort({
        'x.ts': { default: plugin({ id: 'a' }) },
        'y.ts': { default: plugin({ id: 'a' }) },
      }),
    ).toThrow(/重复/);
  });

  it('插件 order 并列被拦截', () => {
    expect(() =>
      validateAndSort({
        'x.ts': { default: plugin({ id: 'a', order: 10 }) },
        'y.ts': { default: plugin({ id: 'b', order: 10 }) },
      }),
    ).toThrow(/order 10 与插件 "a" 相同/);
  });

  it('缺少默认导出被拦截', () => {
    expect(() => validateAndSort({ 'x.ts': {} })).toThrow(RegistryValidationError);
  });
});