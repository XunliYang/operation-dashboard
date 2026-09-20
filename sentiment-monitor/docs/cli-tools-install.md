# CLI 工具安装指南

本文档说明如何安装 sentiment-monitor 依赖的 CLI 工具。

## 工具状态检查

运行以下命令检查工具状态：

```bash
node -e "const { getToolsStatus, printToolsStatus } = require('./src/cli-tools'); getToolsStatus().then(printToolsStatus);"
```

## 必需工具

### curl
- **Windows**: 已内置（Windows 10+）
- **Linux**: `sudo apt install curl` 或 `sudo yum install curl`
- **macOS**: 已内置

## Agent-Reach 工具

### mcporter（MCP 工具调用）
用于 Exa 搜索、微博搜索等 MCP 服务。

```bash
npm install -g mcporter
```

配置 MCP 服务器：
```bash
# Exa 搜索
mcporter config add exa https://mcp.exa.ai/mcp

# 微博搜索（需要安装 mcp-server-weibo）
npm install -g mcp-server-weibo
mcporter config add weibo --command mcp-server-weibo
```

### xhs-cli（小红书搜索）
```bash
npm install -g xhs-cli
```

### bili-cli（B站搜索）
```bash
npm install -g bili-cli
```

## 可选工具

### agent-reach（Agent Reach 主程序）
```bash
npm install -g agent-reach
```

## 验证安装

安装完成后，运行检查命令确认所有工具已正确安装：

```bash
node -e "const { getToolsStatus, printToolsStatus } = require('./src/cli-tools'); getToolsStatus().then(printToolsStatus);"
```

## 工具与数据源对应关系

| 工具 | 数据源 | 必需 |
|------|--------|------|
| curl | Google News, LinkedIn, 百度, V2EX | ✅ |
| mcporter | Exa, 微博 | ❌ |
| xhs-cli | 小红书 | ❌ |
| bili-cli | B站 | ❌ |

**注意**：缺少可选工具不会导致程序崩溃，对应的数据源会被跳过并在日志中显示警告。

## 故障排查

### mcporter 无法找到 MCP 服务器
确保已运行 `mcporter config add` 命令配置服务器。

### xhs-cli / bili-cli 命令未找到
检查 npm 全局安装路径是否在 PATH 环境变量中：
```bash
npm config get prefix
```

### 工具安装后仍然无法使用
尝试重启终端或重新加载环境变量。
