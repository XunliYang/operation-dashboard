# sentiment-monitor

舆情监控系统。每日从多平台采集关键词相关内容，自动过滤噪音，生成风险分析报告并发送邮件。

## 系统概述

- **工作目录**: `sentiment-monitor/`
- **配置文件**: `config/<profile>.json`
- **数据存储**: `data/` 目录
- **健康度日志**: `data/health.log`

## 可用命令

| 命令 | 用途 | 说明 |
|------|------|------|
| `monitor` | 多源数据采集 | RSS/API/CLI 采集，不发送邮件 |
| `search-sites` | 站点补充搜索 | 内置 DuckDuckGo 搜索 CSDN/知乎/掘金等 |
| `send-email` | 发送邮件 | 基于当天数据生成 HTML 邮件并发送 |
| `report` | 查看报告 | 生成并打印指定日期的报告 |
| `history` | 历史摘要 | 查看最近 N 天的监控摘要 |
| `websearch` | 外部搜索合并 | [可选] 从 stdin 读取外部搜索结果 |

## 参数

- `--profile <name>`: 使用 `config/<name>.json` 配置文件
- `--production`: send-email 专用，发送到正式收件人列表

## 推荐流程（每日监控）

**严格按顺序执行，不要跳过或改变顺序。**

### 步骤 1：数据采集

```bash
node src/index.js monitor --profile {profile}
```

- 等待命令完成
- 如果失败，记录错误，**继续步骤 2**

### 步骤 2：站点补充搜索

```bash
node src/index.js search-sites --profile {profile}
```

- 自动搜索 CSDN、知乎、掘金等 11 个站点
- 如果失败，记录错误，**继续步骤 3**

### 步骤 3：发送邮件

```bash
node src/index.js send-email --profile {profile} --production
```

- 如果失败，记录错误，**继续步骤 4**

### 步骤 4：健康度检查

```bash
tail -20 data/health.log
```

- 如果有 `⚠️` 标记的异常，进入步骤 5
- 如果没有异常，**流程结束**

### 步骤 5：异常告警（仅在有异常时）

- 统计异常数据源数量
- 生成告警摘要
- 如果某个源连续 3 天异常，建议用户禁用

## 异常处理

| 步骤 | 失败处理 |
|------|----------|
| 步骤 1 失败 | 记录错误，继续步骤 2 |
| 步骤 2 失败 | 记录错误，继续步骤 3 |
| 步骤 3 失败 | 记录错误，继续步骤 4 |
| 步骤 4 异常 | 生成告警，发送通知 |

**原则**：任何一个步骤失败都不中断流程，尽量完成后续步骤。

## 输出示例

正常完成：
```
✅ 每日监控完成
- 数据采集：成功（45 条）
- 站点搜索：成功（12 条）
- 邮件发送：成功（正式模式）
- 健康度：正常
```

有异常：
```
⚠️ 每日监控完成（有异常）
- 数据采集：成功（45 条）
- 站点搜索：失败（DuckDuckGo 限流）
- 邮件发送：成功（正式模式）
- 健康度：2 个数据源异常
  - weibo: 今天 0 条，7天均值 8.5 条，下降 100%
  - bilibili: 今天 1 条，7天均值 5.2 条，下降 80%
```

## 其他操作

### 查看报告

```bash
node src/index.js report --profile {profile} 2026-07-31
```

### 查看历史摘要

```bash
node src/index.js history --profile {profile}
```

## 注意事项

1. **不要修改执行顺序** — 步骤 1→2→3→4 是固定的
2. **不要跳过失败步骤** — 失败要记录，但继续执行
3. **不要自行判断是否需要发邮件** — 步骤 3 总是执行
4. **不要自行调整参数** — 使用传入的 profile 参数
5. **health.log 路径** — `data/health.log`，如果文件不存在说明没有异常

## 示例调用

```
用户：执行今天的舆情监控，使用 openan 配置

Agent：
1. 执行 node src/index.js monitor --profile openan
2. 执行 node src/index.js search-sites --profile openan
3. 执行 node src/index.js send-email --profile openan --production
4. 查看 data/health.log
5. （如有异常）生成告警
```
