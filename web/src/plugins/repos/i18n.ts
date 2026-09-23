import type { PluginMessages } from '@/shell/contract';

/** 仓库插件词条，key 统一带 `repos.` 前缀。 */
export const messages: PluginMessages = {
  zh: {
    'repos.title': '仓库',
    // 贡献度卡片：词条自管，不依赖 contributions 插件注册（插件间零耦合，PR 复审 P2-2）。
    'repos.contribCard.title': '贡献度',
    'repos.contribCard.top': 'TOP 贡献者',
    'repos.contribCard.viewAll': '查看完整贡献度看板',
    'repos.contribMetric.prs': 'PR 数',
    'repos.contribMetric.commits': 'Commit 数',
    'repos.contribMetric.code': '代码量',
    'repos.contribMetric.issues': 'Issue 数',
    'repos.contribMetric.wiki': 'Wiki 修订',
  },
  en: {
    'repos.title': 'Repos',
    'repos.contribCard.title': 'Contributions',
    'repos.contribCard.top': 'Top contributors',
    'repos.contribCard.viewAll': 'Open contributions dashboard',
    'repos.contribMetric.prs': 'PRs',
    'repos.contribMetric.commits': 'Commits',
    'repos.contribMetric.code': 'Code',
    'repos.contribMetric.issues': 'Issues',
    'repos.contribMetric.wiki': 'Wiki',
  },
};