# 通用舆情监控系统

每日从多平台采集用户配置的关键词相关内容，自动过滤噪音，生成风险分析报告。关键词、品牌名称、邮件模板等全部可通过 `config.json` 配置。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入 SMTP_USER 和 SMTP_PASS

# 3. 配置监控关键词
# 编辑 config.json，修改 keywords 数组

# 4. 执行每日监控（采集数据，不发送邮件）
node src/index.js monitor

# 5. 合并 web_search 补充结果（从 stdin 读取 JSON 数组）
echo '[{"platform":"web-search","title":"...","url":"..."}]' | node src/index.js websearch

# 6. 发送 HTML 模板邮件（基于完整数据）
node src/index.js send-email

# 查看指定日期报告
node src/index.js report 2026-06-05

# 查看历史报告
node src/index.js history
```

## 部署

### 方式一：本地运行

```bash
# 克隆项目
git clone https://github.com/XunliYang/Daily-Search.git
cd Daily-Search

# 直接运行（零依赖）
node src/index.js monitor
```

### 方式二：定时任务

```bash
# crontab 示例：每天早上 8 点执行完整流程（采集 → 合并 → 发邮件）
0 8 * * * cd /path/to/Daily-Search && node src/index.js monitor >> logs/monitor.log 2>&1 && \
  cat /tmp/websearch-results.json | node src/index.js websearch >> logs/monitor.log 2>&1 && \
  node src/index.js send-email >> logs/monitor.log 2>&1
```

### 方式三：OpenClaw 集成（Agent web_search + feed-results）

监控项目代码**无需修改**，由 OpenClaw agent 充当调度器：

1. **agent 侧** — 用 `web_search` 工具搜索 11 个站点（CSDN/知乎/掘金等）+ 关键词变体
2. **结果写入** — agent 将搜索结果写为 JSON 数组到 `/tmp/search-results.json`
3. **走 pipeline** — `node src/index.js feed-results /tmp/search-results.json`
4. **报告投递** — agent 读取报告摘要发到 Discord/Telegram 频道

```bash
# feed-results 模式：接收外部 web_search 结果，合并内部数据源，走完整 pipeline
node src/index.js feed-results /tmp/search-results.json
```

**集成架构：**

```
┌──────────────┐    web_search     ┌──────────────────┐
│ OpenClaw     │ ────────────────→ │ 11 个 site: 查询  │
│ Agent        │                   │ + 关键词变体      │
│ (调度器)     │ ────────────────→ │ DuckDuckGo        │
└──────┬───────┘                   └──────────────────┘
       │ 写 /tmp/search-results.json
       ▼
┌──────────────────────────┐
│ node index.js            │
│   feed-results 模式       │
│   ↓ 合并 RSS + GitHub     │
│   ↓ 去重 + 关键词过滤     │
│   ↓ 风险评估 + 摘要       │
│   ↓ 报告生成              │
└──────┬───────────────────┘
       │ 读取报告
       ▼
┌──────────────┐
│ Agent 发报告  │
│ 到 Discord   │
└──────────────┘
```

**设计理由：** 相比 README 原始的 "传入 webSearch 函数" 方案，agent 直接搜 + 写文件 + CLI 消费 的模式更自然——agent 本身就是调度器，不需要依赖注入。详见 [docs/integration-design.md](docs/integration-design.md)

### 环境要求

- Node.js v22+
- 零外部依赖（仅用 Node.js 内置模块）
- 可选：OpenClaw + agent-reach skill（路由指导）+ mcporter（MCP 工具执行）
- 可选：DuckDuckGo web_search（OpenClaw 内置，批量搜索需加间隔避免限流）
- 可选：gh CLI（GitHub 数据源增强）

## 项目结构

```
sentiment-monitor/
├── package.json              # 项目配置
├── config.json               # 数据源配置（通用模板）
├── .env                      # 环境变量（SMTP密码、API Key）
├── .env.example              # 环境变量示例
├── README.md                 # 本文档
├── references/
│   ├── config-template.json  # 具体项目配置示例
│   ├── config-reference.md   # 配置字段详细说明
│   └── cron-config.md        # 定时任务配置
├── src/
│   ├── configLoader.js       # 配置加载模块（品牌/模板/关键词匹配）
│   ├── index.js              # 主入口 + CLI（多关键词支持 + send-email）
│   ├── email-template.js     # HTML 邮件模板（渐变色 header + 统计卡片 + 风险标记）
│   ├── mailer.js             # 邮件发送模块（HTML 模板 + PDF 附件）
│   ├── search.js             # webSearch 搜索模块
│   ├── fetcher.js            # RSS/HTTP 数据抓取模块（零依赖）
│   ├── agent-reach-fetcher.js # agent-reach CLI 集成模块
│   ├── firecrawl-enricher.js # Firecrawl 网页内容富化模块
│   ├── report.js             # 报告生成 + 平台分类 + AI 摘要 + 评分排序
│   ├── storage.js            # JSON 文件存储模块
│   └── feedback.js           # 运行反馈持久化模块
└── data/                     # 数据存储目录（自动创建）
    ├── YYYY-MM-DD.json       # 按日期分文件
    └── feedback.json         # 运行反馈记录
```

## 关键词配置

### 配置说明

只需修改 `keywords` 数组，其他配置（`rssSources`、`searchVariants`）会自动应用到所有关键词。

```json
{
  "keywords": ["YourKeyword"],
  "keywordConfig": {
    "daysBack": 3,
    "todayOnly": false
  }
}
```

### config.json 完整示例

```json
{
  "project": {
    "name": "sentiment-monitor",
    "displayName": "舆情监控",
    "userAgent": "SentimentMonitor/1.0",
    "emailFrom": "Monitor <noreply@example.com>",
    "emailSubject": "{displayName} 舆情日报 — {date}",
    "reportTitle": "📋 {displayName} 舆情监控日报"
  },
  "keywords": ["YourKeyword"],
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
    "https://www.bing.com/news/search?q=%22{keyword}%22&format=rss",
    "https://hnrss.org/newest?q={keyword}"
  ],
  "sites": [
    { "platform": "csdn", "query": "site:csdn.net" },
    { "platform": "zhihu", "query": "site:zhihu.com" }
  ],
  "email": {
    "enabled": true,
    "smtp": {
      "host": "smtp.example.com",
      "port": 465,
      "secure": true,
      "auth": {
        "user": "${SMTP_USER}",
        "pass": "${SMTP_PASS}"
      }
    },
    "to": ["recipient@example.com"],
    "productionTo": ["recipient@example.com"],
    "productionCc": []
  }
}
```

### 模板变量

- `{keyword}` - 自动替换为当前关键词
- `{displayName}` - 替换为 `project.displayName`
- `{date}` - 替换为当前日期

### 环境变量

敏感信息和关键词应放在 `.env` 文件中：

```bash
# .env 文件
KEYWORDS=YourKeyword,AnotherKeyword
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
FIRECRAWL_API_KEY=your-firecrawl-api-key
GITHUB_TOKEN=your-github-token
```

**优先级：** 环境变量 > config.json > 默认值

## 当前可用平台

> **最后更新**: 2026-06-09 环境实测

### agent-reach 技能 vs CLI 说明

当前环境**仅使用 agent-reach skill + mcporter**，没有安装 agent-reach CLI。

| 组件 | 是否使用 | 角色 |
|------|----------|------|
| agent-reach **skill** | ✅ | 路由指导 — 提供 17 平台的路由表和采集命令参考 |
| agent-reach **CLI** | ❌ | 独立命令行工具，当前环境未安装 |
| **mcporter** | ✅ | MCP 工具路由层 — 实际调用 exa、douyin 等 MCP server |
| **OpenClaw 原生工具** | ✅ | web_search、exec 补充采集 |

**协作方式**: skill 提供知识指导 → mcporter 执行 MCP 工具调用 → OpenClaw 原生工具补充

### 已接入（当前环境实测可用）

| 平台 | 数据源 | 状态 | 说明 |
|------|--------|------|------|
| GitHub | GitHub API (Repos + Issues) | ✅ 正常 | 主要数据源，每日 50+ 条 |
| Google News | RSS 精确匹配 | ✅ 正常 | 按关键词独立配置 |
| Bing News | RSS 精确匹配 | ✅ 正常 | 按关键词独立配置 |
| V2EX | 公开 API | ✅ 正常 | 热门话题，含关键词过滤 |
| 少数派 | 自带 RSS | ✅ 正常 | 通用信息流，关键词过滤 |
| 36Kr | 自带 RSS | ✅ 正常 | 通用信息流，关键词过滤 |
| ITHome | 自带 RSS | ✅ 正常 | 中文科技新闻 |
| FreeBuf | 自带 RSS | ✅ 正常 | 中文安全资讯 |
| 机器之心 | 自带 RSS | ✅ 正常 | 中文 AI 资讯 |
| Hacker News | HNRSS 搜索 | ⚠️ 偶发 502 | 关键词搜索 |
| web_search | DuckDuckGo（OpenClaw 内置） | ✅ 正常 | cron 定时任务自动调用 |
| Exa | mcporter MCP (web_search_exa) | ✅ 正常 | 全网语义搜索，支持 includeDomains |
| 微信公众号 | mcporter MCP + includeDomains=mp.weixin.qq.com | ✅ 正常 | Exa 引擎索引 |
| 抖音 | mcporter MCP (douyin) | ✅ 正常 | stdio 模式，5 个工具可用，无需登录 |
| 微博 | mcporter MCP (weibo) | ✅ 正常 | stdio 模式，10 个工具可用，含 search_content |
| 小红书 | xhs-cli | ✅ 正常 | v0.6.4，search/hot 无需登录 |
| 百度 | Jina Reader | ✅ 正常 | 百度搜索页抓取 + 全字过滤 |

### 当前环境未接入

| 平台 | 采集方式 | 状态 | 原因 |
|------|----------|------|------|
| Twitter/X | twitter-cli | ⚠️ 需 Cookie | 已安装 v0.8.5，需设置 TWITTER_AUTH_TOKEN + TWITTER_CT0 |
| Reddit | rdt-cli | ⚠️ 需 Cookie | 已安装 v0.4.1，API 全面要求认证 |
| B站 | agent-reach CLI | ❌ 未安装 | yt-dlp 可替代基础采集 |
| GitHub CLI | gh | ❌ 未安装 | 已有 GitHub API (fetcher.js) |
| LinkedIn | MCP | ❌ | 需浏览器登录认证 |
| YouTube | yt-dlp | ❌ | 未安装 |

### 预留待接入（config.json 已配置站点）

传入 `webSearch` 函数即可启用：

| 平台 | 查询方式 | 状态 |
|------|----------|------|
| CSDN | site:csdn.net | ⏸️ 需 webSearch |
| 思否 | site:segmentfault.com | ⏸️ 需 webSearch |
| 掘金 | site:juejin.cn | ⏸️ 需 webSearch |
| 博客园 | site:cnblogs.com | ⏸️ 需 webSearch |
| 脉脉 | site:maimai.cn | ⏸️ 需 webSearch，需认证 |
| 知乎 | site:zhihu.com | ⏸️ 需 webSearch |
| 微信公众号 | site:mp.weixin.qq.com | ⏸️ 需 webSearch |
| 头条 | site:toutiao.com | ⏸️ 需 webSearch |
| Facebook | site:facebook.com | ⏸️ 需 webSearch |
| 开源中国 | site:oschina.net | ⏸️ 需 webSearch |
| HelloGithub | site:hellogithub.com | ⏸️ 需 webSearch |

## 数据格式

每条记录格式：
```json
{
  "keyword": "YourKeyword",
  "source_method": "rss|agent_reach|web_search",
  "source_detail": "google-news|bing-news|github|weibo|...",
  "platform": "google-news|bing-news|github|weibo|xiaohongshu|bilibili|baidu|exa|rss|...",
  "title": "标题",
  "url": "链接",
  "snippet": "摘要",
  "summary": "AI 生成的内容摘要",
  "timestamp": "时间戳",
  "risk_level": "low|medium|high",
  "sentiment": "positive|negative|neutral",
  "relevanceScore": 0
}
```

## 使用方法

### 命令行运行

```bash
# 推荐流程（3 步完成每日监控）

# 步骤 1: 执行每日监控（RSS/API/CLI 采集）
node src/index.js monitor

# 步骤 2: 站点补充搜索（内置 DuckDuckGo 搜索 CSDN/知乎/掘金等）
node src/index.js search-sites

# 步骤 3: 发送 HTML 模板邮件
node src/index.js send-email --production
```

#### 多配置文件支持

使用 `--profile` 参数可以切换不同的配置文件，方便监控多个项目：

```bash
# 使用 config/openan.json 配置文件
node src/index.js monitor --profile openan
node src/index.js search-sites --profile openan
node src/index.js send-email --profile openan --production

# 使用 config/projectb.json 配置文件
node src/index.js monitor --profile projectb
```

配置文件放在 `config/` 目录下，每个配置文件完整独立（包含所有字段：RSS源、关键词、邮件配置等）。

#### 数据源健康度监控

系统会在每次 `monitor` 运行后自动检查数据源健康度：

- 对比每个数据源的采集量与最近 7 天均值
- 如果低于均值的 50%，记录异常到 `data/health.log`
- 异常不会自动禁用数据源，需要人工确认

查看健康度日志：
```bash
cat data/health.log
```

#### Agent Skill 集成

推荐使用 Agent Skill 模式，让 agent 按固定流程执行：

```bash
# Agent 调用 daily-monitor skill
# Skill 会自动执行 3 个步骤 + 健康度检查 + 异常告警
```

详见 `.claude/skills/daily-monitor/SKILL.md`

#### 其他命令

```bash
# 查看指定日期报告
node src/index.js report 2026-06-05

# 查看历史报告（默认最近7天）
node src/index.js history

# [可选] 从 stdin 读取外部搜索结果并合并（用于 agent web_search 补充）
echo '[...JSON数组...]' | node src/index.js websearch
```

> **重要**: `monitor` 和 `search-sites` 命令**不发送邮件**，只负责数据采集。邮件发送在 `send-email` 命令中执行。

### 作为模块使用

```javascript
const monitor = require('./src/index.js');

// 多关键词模式（使用 config.json 配置）
const result = await monitor.runDailyMonitor({
  date: '2026-06-05'
});

// 生成每日总结（按平台分栏）
const summary = monitor.report.generateDailySummary(result.report);
```

## 功能特点

### 1. 多关键词监控

- 支持同时监控多个关键词（通过 `config.json` 配置）
- 所有关键词共享相同的 `keywordConfig`、`rssSources` 和 `searchVariants`
- 使用 `{keyword}` 模板变量，自动应用到所有关键词
- 按关键词分别采集、过滤、统计

### 2. 四层采集架构

- **RSS/HTTP 层** — 零依赖 HTTP/RSS 抓取（Google/Bing News/GitHub/少数派/36Kr/ITHome/FreeBuf/机器之心/Hacker News）
- **Agent-Reach 层** — agent-reach CLI/MCP 集成（微博/小红书/B站/V2EX/Exa/百度/抖音等）
- **Web Search 层** — OpenClaw 内置 DuckDuckGo 搜索（cron 定时任务自动调用）
- **Firecrawl 层** — 网页内容富化，提取真实发布时间

### 3. 精确过滤

- **时间过滤** — 统一配置时间窗口（见 `keywordConfig`）
- **全字匹配** — 排除关键词子串误匹配（如关键词 "Foo" 不会匹配 "Foobar"）
- **去重** — 同一天同一 URL 只保留一条

### 4. AI 内容摘要 + 评分排序

参考 [掘金文章](https://juejin.cn/post/7621769753745997851) 的 AI 摘要思路：
- 每条内容自动生成摘要（规则引擎）
- 按风险等级 + 平台权重 + 时间新鲜度评分排序
- Top 10 精选内容输出

### 5. 平台分类报告

按 22 个指定平台顺序分栏输出：

```
─ CSDN: 无
─ 思否: 无
─ 掘金: 无
...
▼ GitHub: 2条
  • feat: redesign website
    📝 Official project description...
    🔗 https://github.com/...
```

### 6. 风险评估

**高风险关键词：** 安全漏洞、数据泄露、攻击、恶意、诉讼、违规、封禁
**中风险关键词：** 竞争、质疑、争议、负面、批评、风险、警告
**低风险关键词：** 新功能、发布、更新、合作、融资、增长

### 7. 情感分析

正面：创新、突破、优秀、领先、成功
负面：失败、问题、风险、下降、裁员

### 8. 反馈持久化

每次运行自动写入 `data/feedback.json`，支持趋势追踪

## RSSHub 公共实例状态

截至 2026-06-05，测试 70+ 个 RSSHub 公共实例均不可用：

| 实例 | 状态 |
|------|------|
| rsshub.app | 403（限制 feed reader 访问） |
| rsshub.rssforever.com | 503 |
| rsshub.pseudoyu.com | 000（不可达） |
| rss.materium.io / rss.ovh / rss.terrychan.me | 503/404 |
| 其余 50+ 实例 | 全部 403/503/502/000 |

**结论：** RSSHub 公共实例生态整体崩盘，短期内不可用。替代方案：自建 RSSHub 实例（需独立服务器）

## 报告示例

```
🔍 舆情监控开始 - 2026-07-09
   关键词配置:
     YourKeyword: 近3日 | RSS源18个

📌 关键词: YourKeyword (近3日)
[monitor][YourKeyword] 过滤: 64 → 2 条 (近3日 + 关键词匹配)
```

## 开发说明

- **config.json**: 通用模板，使用 `{keyword}` 模板变量
- **references/config-template.json**: 具体项目配置示例
- **.env**: 环境变量（SMTP 密码、API Key），不要提交到 Git
- **configLoader.js**: 配置加载和模板替换
- **search.js**: 搜索变体配置，使用 `getSearchVariants(keyword)`
- **fetcher.js**: RSS 源配置，使用 `getRssSources(keyword)`
- **agent-reach-fetcher.js**: agent-reach 数据源（CLI 或 MCP）
- **firecrawl-enricher.js**: Firecrawl 网页内容富化
- **report.js**: 可扩展 `RISK_KEYWORDS`、`SENTIMENT_KEYWORDS`、`PLATFORM_CATEGORIES`
- **storage.js**: 可替换为数据库存储

## License

MIT
