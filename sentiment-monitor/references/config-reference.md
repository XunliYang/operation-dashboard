# 配置参考

## config.json 完整字段说明

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project` | object | ❌ | 项目品牌与显示配置（见下方详细说明） |
| `keywords` | string[] | ✅ | 主关键词列表 |
| `keywordConfig` | object | ✅ | 所有关键词共享的采集参数 |
| `searchVariants` | string[] | ✅ | 搜索变体模板（使用 `{keyword}`） |
| `rssSources` | string[] | ✅ | RSS 源模板（使用 `{keyword}`） |
| `sites` | object[] | ✅ | 定向站点搜索配置 |
| `keywordFilter` | object | ❌ | 关键词匹配模式配置（可选） |
| `email` | object | ✅ | 邮件发送配置 |

### project

项目品牌与显示配置。所有字段均有默认值，可省略。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | `"sentiment-monitor"` | 内部标识（文件名、日志前缀） |
| `displayName` | string | `"舆情监控"` | 显示名称（报告标题、邮件、UI） |
| `description` | string | `"每日检索并分析相关舆情内容"` | 项目描述 |
| `userAgent` | string | `"SentimentMonitor/1.0"` | HTTP 请求 User-Agent |
| `timezone` | string | `"Asia/Shanghai"` | 报告时区（IANA 格式） |
| `defaultKeywords` | string[] | `["YourKeyword"]` | 无 `keywords` 时的回退关键词 |
| `emailFrom` | string | `"Monitor <noreply@example.com>"` | 邮件发件人 |
| `emailSubject` | string | `"{displayName} 舆情日报 — {date}"` | 邮件主题模板 |
| `reportTitle` | string | `"📋 {displayName} 舆情监控日报"` | 报告标题模板 |
| `pdfFilename` | string | `"{name}-report-{date}.pdf"` | PDF 文件名模板 |

模板变量：`{name}` → project.name，`{displayName}` → project.displayName，`{date}` → 当前日期。

### keywords

关键词数组。只需配置一次，`rssSources` 和 `searchVariants` 会自动应用到所有关键词。

```json
{
  "keywords": ["YourKeyword", "AnotherKeyword"]
}
```

### keywordConfig

所有关键词共享的采集参数。

```json
{
  "keywordConfig": {
    "daysBack": 3,
    "todayOnly": false
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `daysBack` | number | `3` | 回溯天数 |
| `todayOnly` | boolean | `false` | 是否只采集今天的数据 |

### searchVariants

搜索变体模板数组，使用 `{keyword}` 占位符。

```json
{
  "searchVariants": [
    "{keyword}",
    "\"{keyword}\"",
    "{keyword} AI"
  ]
}
```

### rssSources

RSS 源模板数组，使用 `{keyword}` 占位符。

```json
{
  "rssSources": [
    "https://news.google.com/rss?q=%22{keyword}%22&hl=zh-CN",
    "https://www.bing.com/news/search?q=%22{keyword}%22&format=rss",
    "https://hnrss.org/newest?q={keyword}"
  ]
}
```

常用 RSS 源：

| 来源 | URL 模板 |
|------|---------|
| Google News (中文) | `https://news.google.com/rss?q=%22{keyword}%22&hl=zh-CN&gl=CN&ceid=CN:zh-Hans` |
| Google News (英文) | `https://news.google.com/rss?q=%22{keyword}%22&hl=en-US&gl=US&ceid=US:en` |
| Bing News | `https://www.bing.com/news/search?q=%22{keyword}%22&format=rss` |
| Hacker News | `https://hnrss.org/newest?q={keyword}` |
| 特定站点 | `https://news.google.com/rss?q=site%3Aexample.com+{keyword}&hl=zh-CN` |

### sites

定向社交平台搜索，通过 WebSearch agent 执行：

```json
[
  { "platform": "zhihu", "query": "site:zhihu.com" },
  { "platform": "weibo", "query": "site:weibo.com OR site:weibo.cn" },
  { "platform": "bilibili", "query": "site:bilibili.com" },
  { "platform": "csdn", "query": "site:csdn.net" },
  { "platform": "weixin", "query": "site:mp.weixin.qq.com" },
  { "platform": "juejin", "query": "site:juejin.cn" },
  { "platform": "toutiao", "query": "site:toutiao.com" },
  { "platform": "36kr", "query": "site:36kr.com" },
  { "platform": "baidu", "query": "site:tieba.baidu.com OR site:zhidao.baidu.com" },
  { "platform": "facebook", "query": "site:facebook.com" }
]
```

### keywordFilter

可选。为特定关键词定义精确匹配和宽泛匹配模式，用于 RSS 全文过滤。

```json
{
  "keywordFilter": {
    "YourKeyword": {
      "exactPatterns": ["精确匹配词1", "精确匹配词2"],
      "broadPatterns": ["宽泛正则1", "宽泛正则2"]
    }
  }
}
```

未配置时，默认使用关键词本身的精确匹配 + 简单包含匹配。

### email

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用邮件 |
| `smtp.host` | SMTP 服务器地址 |
| `smtp.port` | 端口（465=SSL, 587=TLS） |
| `smtp.secure` | 是否使用 SSL |
| `smtp.auth.user` | 登录用户名（支持 `${SMTP_USER}` 环境变量） |
| `smtp.auth.pass` | SMTP 授权码（支持 `${SMTP_PASS}` 环境变量） |
| `to` | 测试收件人列表 |
| `productionTo` | 正式发送收件人列表 |
| `productionCc` | 正式发送抄送列表 |

注意：`email.from` 和 `email.subject` 已从 `project.emailFrom` 和 `project.emailSubject` 读取。

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

### 数据文件格式 (data/YYYY-MM-DD.json)

```json
{
  "date": "2025-01-15",
  "keyword": "YourKeyword",
  "items": [
    {
      "source_method": "rss",
      "source_detail": "google-news",
      "platform": "google-news",
      "title": "文章标题",
      "url": "https://...",
      "snippet": "摘要文本",
      "timestamp": "2025-01-15T10:30:00Z",
      "risk_level": "low|medium|high",
      "keyword": "YourKeyword",
      "sentiment": "positive|negative|neutral",
      "summary": "一句话总结"
    }
  ],
  "metadata": {
    "total_count": 15,
    "last_updated": "2025-01-15T12:00:00Z",
    "platforms": { "google-news": 5, "bing-news": 3 },
    "collection_method": "rss+websearch"
  }
}
```
