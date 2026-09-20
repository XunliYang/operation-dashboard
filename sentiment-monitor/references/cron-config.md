# 每日舆情监控 - 定时任务配置

## OpenClaw Cron Job 定义

```json
{
  "id": "561e81c2-e31c-4f33-92ba-e675ff7dcb1c",
  "name": "每日舆情监控",
  "description": "每日 9:00 UTC 自动执行舆情监控并汇报",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "tz": "UTC"
  },
  "wakeMode": "now",
  "payload": {
    "kind": "agentTurn",
    "message": "执行每日舆情监控任务。严格按以下流程操作：\n\n## 步骤 1: 脚本多源采集\ncd sentiment-monitor && node src/index.js monitor\n\n## 步骤 2: web_search 补充搜索\n用 web_search 搜索以下关键词（各搜一次）：\n- \"{displayName}\" site:weibo.com OR site:bilibili.com OR site:v2ex.com OR site:zhihu.com\n\n收集所有结果的 title, url, snippet, 发布时间。\n\n## 步骤 3: 保存 web_search 结果到数据文件\necho '[{\"platform\":\"web-search\",\"title\":\"标题\",\"url\":\"https://...\",\"snippet\":\"摘要\",\"timestamp\":\"ISO-8601\"}]' | node src/index.js websearch\n\n## 步骤 4: 发送正式邮件\ncd sentiment-monitor && node src/index.js send-email --production",
    "toolsAllow": ["exec", "read", "write", "web_search"],
    "timeoutSeconds": 900
  }
}
```

## 执行流程

```
步骤1: 脚本多源采集    → node src/index.js monitor         （RSS + agent-reach 社交媒体）
步骤2: AI 补充搜索     → web_search 搜索关键词              （补充脚本遗漏的内容）
步骤3: 合并数据        → echo '[...]' | node src/index.js websearch
步骤4: 发送正式邮件    → node src/index.js send-email --production  （HTML 邮件）
```

## 环境变量

在 `.env` 文件中配置：

```bash
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
```

或在执行前设置：

```bash
export SMTP_USER="your-email@example.com"
export SMTP_PASS="授权码"
```

## 邮件配置

- 测试模式：发送到 `email.to` 列表
- 正式模式：发送到 `email.productionTo` 列表，抄送 `email.productionCc`

## 超时配置

- 超时: 900 秒（15 分钟）
- 允许工具: exec, read, write, web_search
