# AI Chat 性能与可靠性增强设计

日期：2026-09-16

## 背景

现有 AI Chat（方案 C：共享 LLM client + 函数调用工具循环）功能已上线，但实测存在三个痛点：执行易出错、很慢/像卡住、频繁报错。

根因：
- 非流式：整个工具循环（最多 6 轮，每轮一次 LLM 请求）跑完才一次性返回，期间前端无进度提示。
- 列表类工具（list_items/list_logs 等）返回全量长字段（标题+URL+摘要+日志），prompt 巨大 → 慢且易错。
- 系统提示太薄，模型常需先调用 list_projects 试错才知道项目 id / 站点格式。
- 单次网络/超时直接失败，无重试。
- 当前 LLM 为 deepseek-v4-pro（火山引擎网关），响应本身偏慢。

## 已确认的范围（方案 A，6 项）

不改交互模型，做性能 + 可靠性增强。

### A1. SSE 流式输出

后端：
- `server/ai/llmClient.js` 新增 `chatCompletionStream({ messages, tools, temperature, maxTokens, config, timeout, retries, onToken })`。请求体加 `stream: true`，用 http/https 解析 LLM 的 SSE 增量行（`data: {...}`），累计 `delta.content` 与 `delta.tool_calls` 分片；`content` 增量实时回调 `onToken`。
- `server/ai/chat.js` 的 `POST /api/ai/chat` 默认走 SSE：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`。事件：
  - `status`：`{"text":"正在调用 <tool>..."}`（每轮工具执行前发出）
  - `content`：`{"delta":"..."}`（最终回答的逐字增量）
  - `done`：`{"content":"<完整回答>"}`
  - `error`：`{"message":"...","code":"TIMEOUT|NETWORK|HTTP_xxx|LLM_NOT_CONFIGURED"}`
- 兼容：请求体带 `stream: false` 时仍返回 JSON（`{content}`），保留现有测试路径。

前端：
- `client/src/services/api.js` 新增 `aiApi.chatStream(messages, { onStatus, onToken, onDone, onError })`，用 `fetch` + `response.body.getReader()` + `TextDecoder` 解析 SSE。
- `client/src/components/ChatWidget.jsx` 改为流式渲染：AI 消息边生成边显示；输入框上方显示当前工具状态。

### A2. 工具结果瘦身

- `list_items`：默认 `limit=10`，返回字段裁为 `id/source/source_type/title(截100字)/url/timestamp/risk_level/sentiment`，去掉 `snippet`。
- `list_logs`：默认 `lines=15`，每行截 200 字。
- `list_collection_history`、`list_decisions`：默认 `limit=10`。
- 所有工具返回值紧凑序列化，避免巨型 JSON 进 prompt。

### A3. 系统提示增强

- 每次请求时，先查一次当前项目列表（`id/name/enabled`），以纯文本快照形式拼进系统提示，模型首轮即知项目与 id。
- 系统提示补充领域说明：site 结构 `{platform, query:"site:xx.com"}`；rssSources 使用 `{keyword}` 模板；关键词/采集参数含义。
- 加 1-2 个 few-shot（加站点、改关键词）。
- 引导：能用一次工具解决就别多轮；拿到结果后用简洁中文回答。

### A4. 重试 + 错误分类

- `chatCompletion` 与 `chatCompletionStream` 支持 `retries`（默认 1）：网络错误（ECONNRESET 等）或超时时，1s 退避后重试一次。
- 错误对象带 `code`：`LLM_NOT_CONFIGURED` / `TIMEOUT` / `NETWORK` / `HTTP_<status>`，chat 路由映射为可读提示。

### A5. 并行工具执行

- 同一轮模型返回多个 `tool_calls` 时，用 `Promise.all` 并行执行（原为串行）。

### A6. maxTokens 提升

- chat 调用 `maxTokens` 从 1024 提到 2048，避免 tool_call 参数 JSON 被截断。

## 改动文件

- `server/ai/llmClient.js`：+`chatCompletionStream`、+`retries`/`timeout` 参数、错误分类。
- `server/ai/chat.js`：SSE 路由、项目快照注入、并行工具执行、错误映射。
- `server/ai/tools.js`：列表工具结果瘦身。
- `client/src/services/api.js`：+`aiApi.chatStream`。
- `client/src/components/ChatWidget.jsx`：流式渲染 + 工具状态提示。
- `tests/server/ai/chat.test.js`：补流式（SSE）与重试用例。

## 错误处理

- LLM 未配置 → SSE `error` 事件 `LLM_NOT_CONFIGURED`，提示去系统配置页填写。
- 超时/网络 → 重试后仍失败 → `error` 事件 `TIMEOUT`/`NETWORK`，友好文案。
- 工具执行失败 → 结果回填给 LLM，由其向用户解释（同现状）。

## 测试

jest + supertest（沿用 `tests/server/`）：
- `chat.test.js`：SSE 流式返回（`stream: true`，断言收到 `done` 事件与 content）；`stream:false` 兼容 JSON；重试逻辑（mock llmClient 首次 reject、二次 resolve）。
- 工具瘦身：断言 `list_items` 返回字段被裁剪、条数受限。

## 范围外（YAGNI）

- 服务端会话持久化 / 聊天历史落库
- 多轮并行请求/取消
- 前端 Markdown 富渲染
- 更换模型 / 多模型路由