/**
 * 构建期静态装配：`import.meta.glob` 抓取所有插件入口，做静态校验后按 order 升序导出。
 *
 * 这里只能校验「静态可见」的东西：默认导出存在、id 唯一、titleKey / order / register 齐备。
 * 路由 path 冲突与 i18n key 前缀合规，只有在 `register(ctx)` 执行后才可见，
 * 因此放到 runtime.ts 的 register* 助手内校验。
 */
import type { Plugin } from './contract';

type RawModule = { default?: unknown };

export class RegistryValidationError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`插件装配失败（${path}）：${reason}`);
    this.name = 'RegistryValidationError';
    this.path = path;
  }
}

/** 纯函数：便于测试注入任意候选集合（空集、缺 titleKey、重复 id 等）。 */
export function validateAndSort(rawModules: Record<string, RawModule>): Plugin[] {
  const plugins: Plugin[] = [];
  const ids = new Set<string>();
  const orders = new Map<number, string>();

  for (const [path, mod] of Object.entries(rawModules)) {
    const plugin = mod?.default;
    if (!plugin || typeof plugin !== 'object') {
      throw new RegistryValidationError(path, '缺少默认导出（default export）');
    }

    const p = plugin as Partial<Plugin>;
    const id = p.id;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new RegistryValidationError(path, '缺少字符串 id');
    }
    if (ids.has(id)) {
      throw new RegistryValidationError(path, `插件 id "${id}" 重复`);
    }
    if (typeof p.titleKey !== 'string' || p.titleKey.trim() === '') {
      throw new RegistryValidationError(path, `插件 "${id}" 缺少 titleKey`);
    }
    if (typeof p.order !== 'number') {
      throw new RegistryValidationError(path, `插件 "${id}" 缺少数值 order`);
    }
    // order 决定导航与首页顺序；并列会让顺序依赖 `import.meta.glob` 的目录扫描结果，
    // 因此显式报错，要求插件各自声明不同 order 作为决定性 tie-break。
    if (orders.has(p.order)) {
      throw new RegistryValidationError(
        path,
        `插件 "${id}" 的 order ${p.order} 与插件 "${orders.get(p.order)}" 相同（并列会依赖目录扫描顺序，请显式区分）`,
      );
    }
    if (typeof p.register !== 'function') {
      throw new RegistryValidationError(path, `插件 "${id}" 缺少 register(ctx)`);
    }

    ids.add(id);
    orders.set(p.order, id);
    plugins.push(plugin as Plugin);
  }

  return plugins.slice().sort((a, b) => a.order - b.order);
}

const rawModules = import.meta.glob<RawModule>('../plugins/*/index.ts', { eager: true });

/** 已按 order 升序排序、通过静态校验的插件清单。 */
export const plugins: Plugin[] = validateAndSort(rawModules);
