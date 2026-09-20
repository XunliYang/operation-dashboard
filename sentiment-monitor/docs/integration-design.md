# 通用舆情监控系统 — 设计文档

> 2026-07-09 | [Daily-Search](https://github.com/XunliYang/Daily-Search)

## 1. 项目定位

每日从多平台采集用户配置的关键词相关内容，自动过滤噪音，生成风险分析报告。

**核心目标：**
- 多关键词统一监控（共享 `keywordConfig`、`rssSources`、`searchVariants`）
- 多平台全覆盖（社交平台 + 新闻 RSS + 代码仓库 + 搜索引擎）
- 精确过滤（时间窗口 + 全字匹配 + URL 去重）
- 自动化（每日定时采集 → 风险评估 → 邮件推送）

## 2. 数据采集架构

系统采用四层采集架构，各司其职：

### 2.1 对比总览

| 维度 | RSS / HTTP Fetcher | Agent-Reach | Web Search | Firecrawl |
|------|-------------------|-------------|------------|-----------|
| **定位** | 稳定数据源（主力） | 社交平台补充 | 长尾站点兜底 | 内容富化 |
| **数据源** | 公开 RSS + GitHub API + Jina Reader | 平台原生 CLI/MCP | DuckDuckGo 搜索引擎 | 网页抓取 API |
| **典型平台** | Google News, Bing News, 36Kr, ITHome, FreeBuf, HackerNews | 微博, 小红书, B站, V2EX, Exa, 百度 | CSDN, 掘金, 知乎, 思否, 博客园, 微信公众号 | 任意网页 |
| **依赖** | 零依赖（Node.js 内置 http 模块） | agent-reach CLI（Python 生态） | OpenClaw web_search 工具 | Firecrawl API |
| **登录要求** | 不需要 | 部分平台需要 Cookie | 不需要 | API Key |
| **结构化程度** | 高（标题/摘要/时间/作者） | 高（平台原生数据结构） | 低（标题+摘要+URL） | 高（markdown + metadata） |
| **稳定性** | ✅ 高（标准协议，极少失效） | ⚠️ 中（依赖 Cookie 和平台策略） | ⚠️ 中（bot-detection 限流） | ✅ 高（付费服务） |
| **噪声率** | 低（精确关键词匹配） | 中（站内搜索偶有偏差） | 高（需额外关键词过滤） | 低（精确抓取） |

### 2.2 RSS / HTTP Fetcher 层（主力层）

**设计思路：** 利用平台提供的标准 RSS/Atom feed 或公开 API，零依赖抓取。

**覆盖平台：**
- 新闻类：Google News, Bing News（精确关键词匹配 RSS）
- 科技媒体：少数派, 36Kr, ITHome, FreeBuf, 机器之心（自带 RSS feed）
- 社区类：Hacker News（HNRSS 搜索 API）
- 代码类：GitHub（Repos + Issues API）
- 搜索类：百度（Jina Reader 页面抓取）

**关键技术：**
- RSS 解析：Node.js `http` 模块 + XML 解析
- 关键词过滤：feed 级别过滤，减少下游处理量
- 去重：URL 级别去重，按日期分文件存储

**特点：** 稳定性最高，是系统的基座。每次运行贡献 50-100+ 条数据。

### 2.3 Agent-Reach 层（社交平台层）

**设计思路：** 通过 agent-reach CLI 工具集访问社交平台的内部数据，补充 RSS 覆盖不到的平台。

**覆盖平台：**
- 免登录：V2EX（公开 API）、Exa（全网语义搜索）、微博（免登录搜索）
- 需 Cookie：Twitter/X、小红书、雪球、微信公众号
- 需额外配置：小宇宙（Groq Key）、抖音（MCP 服务）、LinkedIn（浏览器登录）
- 需代理：Reddit、B站完整版（服务器 IP 被屏蔽时）

**关键技术：**
- CLI 调用：`agent-reach` 命令行工具统一封装
- MCP 协议：`mcporter` 管理抖音、LinkedIn 等 MCP 服务
- Cookie 管理：Cookie-Editor 导出 + agent-reach configure 导入

**特点：** 数据质量高（原生内容），但部分平台需要用户手动提供 Cookie。

### 2.4 Web Search 层（长尾兜底层）

**设计思路：** 用通用搜索引擎覆盖 RSS 和 Agent-Reach 都没有的长尾站点。

**覆盖平台：**
- 技术社区：CSDN, 掘金, 知乎, 思否, 博客园, 开源中国, HelloGithub
- 其他：微信公众号, 头条, Facebook, 脉脉

**搜索方式：**
- site: 查询：`site:csdn.net "{keyword}"` 等定向搜索
- 关键词变体：不限站点的广泛搜索，覆盖拼写变体

**关键技术：**
- OpenClaw 内置 `web_search` 工具（DuckDuckGo）
- 搜索间隔 3-5 秒防限流
- bot-detection 错误跳过策略

**特点：** 覆盖面最广，但噪声率最高，需要额外的关键词匹配过滤。

### 2.5 Firecrawl 层（内容富化层）

**设计思路：** 对 web_search 结果进行内容富化，提取真实发布时间和详细摘要。

**功能：**
- 提取网页发布时间（从 metadata、HTML time 标签、正文等）
- 提取详细摘要（从 og:description、正文段落等）
- 特殊平台处理（微博移动端 API、知乎直接提取）

**关键技术：**
- Firecrawl API 抓取网页内容
- 多种时间提取策略（metadata、HTML、正则匹配）
- 并发控制（限制 3 个并发避免 rate limit）

**特点：** 提高数据质量，但需要 API Key 且增加处理时间。

## 3. 数据流

```
┌──────────────────────────────────────────────────────────────┐
│                      采集层                                   │
│                                                              │
│  RSS/HTTP ──→ Google News, Bing News, 36Kr, ITHome...       │
│  (零依赖)       GitHub API, Jina Reader                       │
│                                                              │
│  Agent-Reach → 微博, 小红书, B站, V2EX, Exa, 百度            │
│  (CLI/MCP)     Twitter, LinkedIn (需 Cookie)                  │
│                                                              │
│  Web Search ─→ CSDN, 掘金, 知乎, 思否... (site: 查询)        │
│  (DuckDuckGo)  关键词变体广泛搜索                             │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                      处理层                                   │
│                                                              │
│  ① URL 去重 → 同一 URL 只保留一条                             │
│  ② 时间过滤 → 统一配置时间窗口（见 keywordConfig）            │
│  ③ 全字匹配 → 排除关键词子串误匹配                            │
│  ④ 风险评估 → 高风险/中风险/低风险 三级分类                   │
│  ⑤ 情感分析 → 正面/负面/中性                                  │
│  ⑥ AI 摘要 → 规则引擎生成内容摘要                             │
│  ⑦ 评分排序 → 风险等级 + 平台权重 + 时间新鲜度                │
│  ⑧ Firecrawl 富化 → 提取真实发布时间和详细摘要                │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                      输出层                                   │
│                                                              │
│  存储 → data/YYYY-MM-DD.json（按日期分文件，增量合并）        │
│  报告 → 平台分栏输出 + 统计 + 建议                            │
│  反馈 → data/feedback.json（趋势追踪）                        │
│  邮件 → HTML 模板邮件（测试/正式双通道）                       │
└──────────────────────────────────────────────────────────────┘
```

## 4. 四种采集方式的选择策略

| 场景 | 优先选择 | 原因 |
|------|---------|------|
| 新闻/媒体/博客 | RSS | 标准协议，稳定可靠，零依赖 |
| 代码仓库 | GitHub API | 结构化数据，信息完整 |
| 社交平台（免登录） | Agent-Reach | 原生接口，数据质量高 |
| 社交平台（需 Cookie） | Agent-Reach | 需用户配置，但质量远超 web search |
| 技术社区（无 RSS） | Web Search | site: 查询是唯一可行方式 |
| 长尾/冷门站点 | Web Search | 兜底覆盖 |
| web_search 结果 | Firecrawl | 提取真实发布时间，提高数据质量 |

**核心原则：** RSS 为主力（稳）、Agent-Reach 为补充（深）、Web Search 为兜底（广）、Firecrawl 为富化（精）。

## 5. 多关键词设计

### 5.1 配置简化

所有关键词共享相同的配置，使用 `{keyword}` 模板变量：

```json
{
  "keywords": ["Keyword1", "Keyword2"],
  "keywordConfig": {
    "daysBack": 3,
    "todayOnly": false
  },
  "searchVariants": [
    "{keyword}",
    "\"{keyword}\"",
    "{keyword} AI"
  ],
  "rssSources": [
    "https://news.google.com/rss?q=%22{keyword}%22&hl=zh-CN",
    "https://www.bing.com/news/search?q=%22{keyword}%22&format=rss"
  ]
}
```

只需修改 `keywords` 数组，其他配置自动应用到所有关键词。

### 5.2 模板替换

`configLoader.js` 提供以下函数：

- `getSearchVariants(keyword)` - 返回替换后的搜索变体
- `getRssSources(keyword)` - 返回替换后的 RSS 源
- `getKeywordConfig()` - 返回共享的关键词配置

## 6. 关键设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-07 | 四层采集架构 | 单一数据源不够覆盖所有平台 |
| 2026-07 | RSS 为主力层 | 标准协议最稳定，零依赖 |
| 2026-07 | 关键词配置简化 | 避免重复配置，使用模板变量 |
| 2026-07 | 全字匹配过滤 | 排除关键词子串误匹配 |
| 2026-07 | 增量存储（URL 去重合并） | 支持多次运行结果合并 |
| 2026-07 | Firecrawl 内容富化 | 提取真实发布时间，提高数据质量 |
| 2026-07 | 搜索间隔 3-5 秒 | DuckDuckGo bot-detection 限流 |
| 2026-07 | 外部结果关键词过滤 | web search 噪声率 >90% |
| 2026-07 | 移除 Discord 推送 | 简化输出，专注邮件推送 |

## 7. 已知限制

| 限制 | 影响 | 缓解方案 |
|------|------|---------|
| DuckDuckGo 批量限流 | 多个站点可能部分失败 | 搜索间隔 + 跳过策略 |
| RSSHub 公共实例全线不可用 | 无法通过 RSSHub 扩展数据源 | 使用平台自带 RSS |
| Agent-Reach Cookie 需手动提供 | Twitter/小红书/LinkedIn 等需用户操作 | Cookie-Editor 一键导出 |
| Firecrawl API 限额 | 免费额度有限 | 仅对 web_search 结果富化 |
| 存储增量合并 | 多次运行会累积历史数据 | 按日期分文件，不影响过滤 |
