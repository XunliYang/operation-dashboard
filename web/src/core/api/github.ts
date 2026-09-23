/**
 * GitHub 头像 / 主页外链（共享层）。
 *
 * 原定义在 `plugins/people/api.ts`，贡献度插件同样要展示头像 + @login 外链，
 * 而插件间禁止互相 import（`shell/contract.ts` 的边界约束），故上提到 core
 * 供多个插件复用。`plugins/people/api.ts` 保留 re-export 以维持既有引用。
 */
export function githubAvatar(login: string): string {
  return `https://github.com/${login}.png`;
}

export function githubProfile(login: string): string {
  return `https://github.com/${login}`;
}