# AI Chat 助手设计

日期：2026-09-16

## 目标

在舆情监控系统 Web UI 中新增一个 AI Chat 助手，通过自然语言辅助用户完成功能设置、站点（site）添加、项目管理等操作。AI 能真正执行操作（读写数据库/改配置），而不是只给建议。

## 已确认的决策

1. AI 能直接执行操作（写数据库/改配置）。
2. 复用系统已有的 LLM 配置（`/api/config/llm`，OpenAI 兼容接口，存于 `config` 表的 `llm_config`）。
3. UI 形态为全局悬浮聊天窗口（右下角悬浮球，任意页面可唤起）。
4. 可操作范围（全选）：项目监控配置、项目管理、系统全局配置、只读查询/触发采集。
5. 采用方案 C：函数调用工具循环 + 共享 LLM Client 抽象（顺带消除 `relevanceChecker.js` 与 `config.js` 中重复的 LLM 调用逻辑）。
6. 首版非流式输出，流式 SSE 作为后续增强。
7. `delete_project` 保留但强制确认（破坏性操作需再次确认）。

## 后端架构

新增 `server/ai/` 目录：

```
server/ai/
├── llmClient.js      # 共享 LLM 客户端（从 relevanceChecker 抽出并增强）
├── tools.js          # 工具注册表：JSON Schema 定义 + 执行器
└── chat.js           # /api/ai/chat 路由（工具调用循环）
```

### llmClient.js

- 迁移 `relevanceChecker.js` 中的 `getLLMConfig()`（从 `config` 表读 `llm_config`）。
- 提供 `chatCompletion({ messages, tools, temperature, maxTokens })`，返回 `{ content, tool_calls }`。
- 支持 http/https、超时、错误解析。
- `relevanceChecker.js` 与 `config.js` 的 LLM 测试接口改为引用本模块，消除重复。

### tools.js

每个工具含 `name / description / parameters(JSON Schema) / execute(args)`。执行器直接复用 `getDb()`、`scheduler`、`notifier`、`logger`，与现有 REST 路由同源。

工具清单：

| 范围 | 工具 |
|------|------|
| 项目监控配置 | `add_keyword` / `remove_keyword`、`add_site` / `remove_site`、`add_rss_source` / `remove_rss_source`、`update_collection_config`(daysBack/todayOnly/searchVariants) |
| 项目管理 | `list_projects` / `get_project` / `create_project` / `update_project` / `delete_project` / `enable_project` / `disable_project` |
| 全局配置 | `get_config` / `update_config_rules` / `update_llm_config` / `update_email_config` |
| 查询/触发 | `trigger_collection` / `get_scheduler_status` / `list_items` / `list_collection_history` / `list_decisions` / `list_logs` |

站点（site）结构沿用 `config.json` 中的 `sites` 数组元素 `{ "platform": "...", "query": "..." }`。

### chat.js

- `POST /api/ai/chat`，body `{ messages }`（首版非流式）。
- 工具调用循环：
  1. 调用 LLM（带工具定义）。
  2. 若返回 `tool_calls`，逐个执行；结果以 `role: "tool"` 回填，同时回填 assistant 的 tool_calls 消息。
  3. 继续循环，最多 6 轮。
  4. 返回最终 assistant 文本回答。

## 安全边界

- 系统提示词明确：删除项目、禁用项目、修改 LLM/邮件配置等破坏性操作，AI 必须先向用户复述意图并要求确认，用户明确同意后才调用对应工具。
- `delete_project` 工具额外强制 `confirm: true` 参数。
- `tool_calls` 参数做类型/必填校验，非法参数回填错误信息给 LLM。

## 前端

- `client/src/components/ChatWidget.jsx`：右下角悬浮球 + 弹窗面板（antd `FloatButton` + `Card`），全局挂在 `Layout.jsx` 的 `<Layout>` 内。
- 消息列表（用户右、AI 左）、loading 态、纯文本 + 换行渲染。
- `client/src/services/api.js` 增加 `aiApi.chat(messages)`。
- 会话状态保存在前端内存，无服务端持久化，每次发送全量 `messages`。

## 错误处理

- LLM 未配置 → 提示「请先到系统配置填写 LLM」。
- LLM 调用失败/超时 → 友好文案 + 服务端日志。
- 工具执行报错 → 回填错误给 LLM，由 LLM 解释并向用户说明。

## 测试

jest（沿用 `tests/server/` 体系，supertest）：
- 工具执行器单测：`add_site` 正确修改 config 的 sites 数组；`add_keyword` / `remove_keyword` 等。
- 工具循环：mock `llmClient` 验证多轮 tool_calls 收敛与最终返回。

## 范围外（YAGNI）

- 流式输出（SSE）
- 服务端会话持久化 / 聊天历史
- 多用户/权限控制
- 前端富文本/Markdown 渲染