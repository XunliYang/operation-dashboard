# AI Chat 性能与可靠性增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 AI Chat：SSE 流式输出 + 工具结果瘦身 + 系统提示注入项目快照 + 失败重试 + 并行工具执行。

**Architecture:** 后端 `server/ai/` 现有三件套增强：`llmClient` 加流式与重试、`chat.js` 改 SSE 并注入项目快照/并行执行/错误分类、`tools.js` 列表结果裁剪。前端 `api.js` 加 `chatStream`、`ChatWidget` 改流式渲染。

**Tech Stack:** Node.js + Express + better-sqlite3，React 18 + antd 5，jest + supertest。

---

## 文件结构

- `server/ai/llmClient.js`（整体重写）— 加 `chatCompletionStream`、`retries`/`timeout`/`retryDelay` 参数、错误分类（`LLM_NOT_CONFIGURED`/`TIMEOUT`/`NETWORK`/`HTTP_<status>`/`PARSE_ERROR`）
- `server/ai/tools.js`（局部修改）— 加 `truncate` 帮助函数，`list_items`/`list_logs`/`list_collection_history`/`list_decisions` 结果瘦身
- `server/ai/chat.js`（整体重写）— SSE + 系统提示注入项目快照 + 并行工具执行 + 错误映射 + JSON 兼容路径
- `client/src/services/api.js`（局部修改）— `aiApi.chat` 加 `stream:false`，新增 `aiApi.chatStream`
- `client/src/components/ChatWidget.jsx`（整体重写）— 流式渲染 + 工具状态提示
- `tests/server/ai/llmClient.test.js`（追加用例）— 重试 + SSE 解析
- `tests/server/ai/chat.test.js`（整体重写）— JSON 路径改为 `stream:false`、新增 SSE 用例、多工具用例
- `tests/server/ai/tools.test.js`（追加用例）— `list_items` 裁剪

---

## Task 1: llmClient 增强（重试 + 错误分类 + 流式）

**Files:**
- Modify: `server/ai/llmClient.js`
- Test: `tests/server/ai/llmClient.test.js`

- [ ] **Step 1: 追加失败测试**

在 `tests/server/ai/llmClient.test.js` 中，`describe` 块内追加（保持已有的 5 个测试不动）。先在文件顶部确认已有 `const EventEmitter = require('events'); const http = require('http');`。

追加的辅助函数与用例：

```js
  function mockHttpChunks(statusCode, chunks, failTimes = 0) {
    let calls = 0;
    jest.spyOn(http, 'request').mockImplementation((options, callback) => {
      calls++;
      const req = { write: jest.fn(), end: jest.fn(), on: jest.fn(), destroy: jest.fn() };
      if (calls <= failTimes) {
        process.nextTick(() => {
          const errHandler = req.on.mock.calls.find((c) => c[0] === 'error')?.[1];
          if (errHandler) errHandler(new Error('ECONNRESET'));
        });
        return req;
      }
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        callback(res);
        for (const c of chunks) res.emit('data', Buffer.from(c));
        res.emit('end');
      });
      return req;
    });
    return () => calls;
  }

  it('chatCompletion 网络错误重试后成功', async () => {
    const getCalls = mockHttpChunks(200, [
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    ], 1);

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      retries: 1,
      retryDelay: 0,
    });

    expect(result.content).toBe('ok');
    expect(getCalls()).toBe(2);
  });

  it('chatCompletionStream 解析 SSE 内容与工具调用', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_projects","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    mockHttpChunks(200, chunks);

    const tokens = [];
    const result = await chatCompletionStream({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      retryDelay: 0,
      onToken: (t) => tokens.push(t),
    });

    expect(result.content).toBe('你好世界');
    expect(tokens).toEqual(['你好', '世界']);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].function.name).toBe('list_projects');
    expect(result.tool_calls[0].function.arguments).toBe('{}');
  });
```

同时需要在文件顶部 import 处加上 `chatCompletionStream`：把原有的
```js
const { getLLMConfig, chatCompletion } = require('../../../server/ai/llmClient');
```
改为
```js
const { getLLMConfig, chatCompletion, chatCompletionStream } = require('../../../server/ai/llmClient');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server/ai/llmClient.test.js`
Expected: FAIL（`chatCompletionStream is not a function`，且重试用例失败）

- [ ] **Step 3: 整体重写 `server/ai/llmClient.js`**

```js
const https = require('https');
const http = require('http');
const { getDb } = require('../db');

const LLM_TIMEOUT = 15000;

function getLLMConfig() {
  const db = getDb();
  const config = db.prepare("SELECT value FROM config WHERE key = 'llm_config'").get();

  if (!config) {
    return null;
  }

  try {
    return JSON.parse(config.value);
  } catch (e) {
    return null;
  }
}

function resolveConfig(config) {
  const llmConfig = config || getLLMConfig();
  if (!llmConfig || !llmConfig.enabled || !llmConfig.apiKey) {
    const error = new Error('LLM 未配置或未启用');
    error.code = 'LLM_NOT_CONFIGURED';
    throw error;
  }
  return llmConfig;
}

function buildBody({ llmConfig, messages, tools, temperature, maxTokens, stream }) {
  const body = {
    model: llmConfig.model || 'gpt-3.5-turbo',
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (stream) {
    body.stream = true;
  }
  return body;
}

function buildRequestOptions({ llmConfig, postData, timeout }) {
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const url = new URL(`${baseUrl}/chat/completions`);
  return {
    url,
    options: {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmConfig.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout,
    },
  };
}

function normalizeHttpError(statusCode, body) {
  let detail = body;
  try {
    const json = JSON.parse(body);
    detail = json.error?.message || body;
  } catch (e) {
    // ignore parse error, keep raw body
  }
  const error = new Error(`LLM 调用失败: ${detail}`);
  error.code = `HTTP_${statusCode}`;
  error.statusCode = statusCode;
  return error;
}

function normalizeTransportError(e, kind) {
  const error = new Error(kind === 'timeout' ? 'LLM 请求超时' : `LLM 网络错误: ${e.message}`);
  error.code = kind === 'timeout' ? 'TIMEOUT' : 'NETWORK';
  return error;
}

async function withRetry(fn, retries, retryDelay) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const retryable = e.code === 'NETWORK' || e.code === 'TIMEOUT';
      if (!retryable || attempt === retries) {
        throw e;
      }
      if (retryDelay > 0) {
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }
  }
  throw lastError;
}

function makeRequest({ llmConfig, postData, timeout }) {
  const { url, options } = buildRequestOptions({ llmConfig, postData, timeout });
  const protocol = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', (e) => reject(normalizeTransportError(e, 'error')));
    req.on('timeout', () => { req.destroy(); reject(normalizeTransportError(new Error('timeout'), 'timeout')); });
    req.write(postData);
    req.end();
  });
}

async function chatCompletion({ messages, tools, temperature = 0, maxTokens = 1024, config, timeout = LLM_TIMEOUT, retries = 0, retryDelay = 1000 }) {
  const llmConfig = resolveConfig(config);
  const postData = JSON.stringify(buildBody({ llmConfig, messages, tools, temperature, maxTokens, stream: false }));

  const response = await withRetry(() => makeRequest({ llmConfig, postData, timeout }), retries, retryDelay);

  if (response.statusCode !== 200) {
    throw normalizeHttpError(response.statusCode, response.body);
  }

  let json;
  try {
    json = JSON.parse(response.body);
  } catch (e) {
    const error = new Error('LLM 响应解析失败');
    error.code = 'PARSE_ERROR';
    error.statusCode = response.statusCode;
    throw error;
  }

  const message = json.choices?.[0]?.message || {};

  return {
    content: (message.content || '').trim(),
    tool_calls: message.tool_calls || [],
  };
}

function makeStreamRequest({ llmConfig, postData, timeout, onToken }) {
  const { url, options } = buildRequestOptions({ llmConfig, postData, timeout });
  const protocol = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let statusCode;
    let rawBody = '';
    let buffer = '';
    let content = '';
    const toolCallsMap = {};

    const req = protocol.request(options, (res) => {
      statusCode = res.statusCode;

      res.on('data', (chunk) => {
        if (statusCode !== 200) {
          rawBody += chunk;
          return;
        }
        buffer += chunk.toString('utf-8');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of rawEvent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let json;
            try {
              json = JSON.parse(data);
            } catch (e) {
              continue;
            }
            const delta = json.choices?.[0]?.delta || {};
            if (delta.content) {
              content += delta.content;
              if (onToken) onToken(delta.content);
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const i = tc.index ?? 0;
                if (!toolCallsMap[i]) {
                  toolCallsMap[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                }
                if (tc.id) toolCallsMap[i].id += tc.id;
                if (tc.function?.name) toolCallsMap[i].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsMap[i].function.arguments += tc.function.arguments;
              }
            }
          }
        }
      });

      res.on('end', () => {
        if (statusCode !== 200) {
          resolve({ statusCode, body: rawBody });
          return;
        }
        const tool_calls = Object.keys(toolCallsMap)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => toolCallsMap[k]);
        resolve({ statusCode, content, tool_calls });
      });
    });

    req.on('error', (e) => reject(normalizeTransportError(e, 'error')));
    req.on('timeout', () => { req.destroy(); reject(normalizeTransportError(new Error('timeout'), 'timeout')); });
    req.write(postData);
    req.end();
  });
}

async function chatCompletionStream({ messages, tools, temperature = 0, maxTokens = 1024, config, timeout = LLM_TIMEOUT, retries = 0, retryDelay = 1000, onToken }) {
  const llmConfig = resolveConfig(config);
  const postData = JSON.stringify(buildBody({ llmConfig, messages, tools, temperature, maxTokens, stream: true }));

  const parsed = await withRetry(() => makeStreamRequest({ llmConfig, postData, timeout, onToken }), retries, retryDelay);

  if (parsed.statusCode !== 200) {
    throw normalizeHttpError(parsed.statusCode, parsed.body);
  }

  return {
    content: (parsed.content || '').trim(),
    tool_calls: parsed.tool_calls || [],
  };
}

module.exports = { getLLMConfig, chatCompletion, chatCompletionStream };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/server/ai/llmClient.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add server/ai/llmClient.js tests/server/ai/llmClient.test.js
git commit -m "feat: llmClient 增加流式调用、重试与错误分类"
```

---

## Task 2: tools.js 结果瘦身

**Files:**
- Modify: `server/ai/tools.js`
- Test: `tests/server/ai/tools.test.js`

- [ ] **Step 1: 追加失败测试**

在 `tests/server/ai/tools.test.js` 的 `describe` 块内追加：

```js
  it('list_items 裁剪字段并限制条数', () => {
    for (let i = 0; i < 25; i++) {
      db.prepare("INSERT INTO items (project_id, source, title, url, timestamp) VALUES (?, ?, ?, ?, ?)")
        .run(projectId, 'google-news', `标题标题标题${i}`, `https://example.com/${i}`, `2026-08-01T00:${String(i).padStart(2, '0')}:00Z`);
    }
    const res = call('list_items', { project_id: projectId });
    expect(res.success).toBe(true);
    expect(res.result.items).toHaveLength(10);
    expect(res.result.items[0]).not.toHaveProperty('snippet');
    expect(res.result.items[0]).toHaveProperty('title');
    expect(res.result.items[0]).toHaveProperty('source');
    expect(res.result.items[0]).toHaveProperty('timestamp');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server/ai/tools.test.js`
Expected: FAIL（`res.result.items` 长度为 20，或含 snippet 字段）

- [ ] **Step 3: 修改 `server/ai/tools.js`**

**3a.** 在文件顶部（`const LOG_DIR = ...` 之后、`function getProject` 之前）加 `truncate` 帮助函数：

```js
function truncate(str, max) {
  if (str == null) return str;
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
```

**3b.** 替换 `list_items` 工具整个对象（含 `name`/`description`/`parameters`/`execute`）为：

```js
  {
    name: 'list_items',
    description: '查询指定项目最近的采集条目（标题/来源/链接/时间/风险/情感，最多返回 limit 条，标题截断）',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        limit: { type: 'number', description: '条数，默认 10' },
      },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const limit = parseInt(args.limit, 10) || 10;
      const rows = db.prepare(
        'SELECT id, source, source_type, title, url, risk_level, sentiment, timestamp FROM items WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(id, limit);
      const items = rows.map((it) => ({
        id: it.id,
        source: it.source,
        source_type: it.source_type,
        title: truncate(it.title, 100),
        url: it.url,
        risk_level: it.risk_level,
        sentiment: it.sentiment,
        timestamp: it.timestamp,
      }));
      return { count: items.length, items };
    },
  },
```

**3c.** 替换 `list_collection_history` 工具整个对象为：

```js
  {
    name: 'list_collection_history',
    description: '查询采集历史记录（最多返回 limit 条）',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID（可选）' },
        limit: { type: 'number', description: '条数，默认 10' },
      },
    },
    execute(args) {
      const db = getDb();
      const limit = parseInt(args.limit, 10) || 10;
      let rows;
      if (args.project_id) {
        const id = requireProjectId(args);
        rows = db.prepare(
          'SELECT id, project_id, trigger_type, status, items_count, started_at, completed_at, error_message FROM collection_history WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'
        ).all(id, limit);
      } else {
        rows = db.prepare(
          'SELECT id, project_id, trigger_type, status, items_count, started_at, completed_at, error_message FROM collection_history ORDER BY started_at DESC LIMIT ?'
        ).all(limit);
      }
      return { count: rows.length, history: rows };
    },
  },
```

**3d.** 替换 `list_decisions` 工具整个对象为：

```js
  {
    name: 'list_decisions',
    description: '查询决策记录（最多返回 limit 条）',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID（可选）' },
        limit: { type: 'number', description: '条数，默认 10' },
      },
    },
    execute(args) {
      const db = getDb();
      const limit = parseInt(args.limit, 10) || 10;
      let rows;
      if (args.project_id) {
        const id = requireProjectId(args);
        rows = db.prepare('SELECT * FROM decisions WHERE project_id = ? ORDER BY executed_at DESC LIMIT ?').all(id, limit);
      } else {
        rows = db.prepare('SELECT * FROM decisions ORDER BY executed_at DESC LIMIT ?').all(limit);
      }
      return { count: rows.length, decisions: rows };
    },
  },
```

**3e.** 替换 `list_logs` 工具整个对象为：

```js
  {
    name: 'list_logs',
    description: '查看最近的运行日志（最多返回 lines 行，每行截断）',
    parameters: {
      type: 'object',
      properties: { lines: { type: 'number', description: '返回最近 N 行，默认 15' } },
    },
    execute(args) {
      const lines = parseInt(args.lines, 10) || 15;
      const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).sort();
      const appLog = files.filter((f) => /^app-.*\.log$/.test(f)).sort().pop();
      let tail = [];
      if (appLog) {
        const content = fs.readFileSync(path.join(LOG_DIR, appLog), 'utf-8');
        tail = content.split('\n').filter((l) => l.trim()).slice(-lines).map((l) => truncate(l, 200));
      }
      return { files: files.slice(-20), latestFile: appLog || null, tail };
    },
  },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/server/ai/tools.test.js`
Expected: PASS（8 tests）

- [ ] **Step 5: 提交**

```bash
git add server/ai/tools.js tests/server/ai/tools.test.js
git commit -m "feat: AI 工具列表结果裁剪瘦身"
```

---

## Task 3: chat.js 重写（SSE + 项目快照 + 并行工具 + 错误映射）

**Files:**
- Modify: `server/ai/chat.js`
- Test: `tests/server/ai/chat.test.js`

- [ ] **Step 1: 整体重写测试 `tests/server/ai/chat.test.js`**

```js
jest.mock('../../../server/ai/llmClient');

const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');
const { chatCompletion, chatCompletionStream } = require('../../../server/ai/llmClient');

describe('AI Chat API', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM config');
    jest.clearAllMocks();
  });

  afterAll(() => {
    db.close();
  });

  const sseParser = (r, cb) => {
    let b = '';
    r.on('data', (c) => { b += c; });
    r.on('end', () => cb(null, b));
  };

  it('JSON 模式：执行工具调用并返回最终回答', async () => {
    chatCompletion
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_projects', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ content: '当前没有项目。', tool_calls: [] });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '有哪些项目？' }], stream: false })
      .expect(200);

    expect(res.body.content).toBe('当前没有项目。');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('JSON 模式：同一轮多个工具调用均被执行', async () => {
    chatCompletion
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_projects', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'get_scheduler_status', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ content: '完成。', tool_calls: [] });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '项目和调度器状态' }], stream: false })
      .expect(200);

    expect(res.body.content).toBe('完成。');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('JSON 模式：未配置 LLM 时返回 400', async () => {
    const err = new Error('LLM 未配置');
    err.code = 'LLM_NOT_CONFIGURED';
    chatCompletion.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }], stream: false })
      .expect(400);

    expect(res.body.error.message).toContain('LLM');
  });

  it('messages 为空时返回 400', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [], stream: false })
      .expect(400);

    expect(res.body.error.message).toBeTruthy();
  });

  it('SSE 模式：返回 content 与 done 事件', async () => {
    chatCompletionStream.mockImplementationOnce(async ({ onToken }) => {
      if (onToken) {
        onToken('你好');
        onToken('，世界');
      }
      return { content: '你好，世界', tool_calls: [] };
    });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '你好' }] })
      .buffer(true)
      .parse(sseParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: content');
    expect(res.body).toContain('你好');
    expect(res.body).toContain('event: done');
  });

  it('SSE 模式：LLM 未配置时返回 error 事件', async () => {
    const err = new Error('LLM 未配置');
    err.code = 'LLM_NOT_CONFIGURED';
    chatCompletionStream.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .buffer(true)
      .parse(sseParser)
      .expect(200);

    expect(res.body).toContain('event: error');
    expect(res.body).toContain('LLM');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server/ai/chat.test.js`
Expected: 部分用例失败（SSE 用例失败；现有 JSON 用例因默认改为流式而行为不符）

- [ ] **Step 3: 整体重写 `server/ai/chat.js`**

```js
const express = require('express');
const { chatCompletion, chatCompletionStream } = require('./llmClient');
const { getToolDefinitions, executeTool } = require('./tools');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

const MAX_ITERATIONS = 6;
const CHAT_TIMEOUT = 120000;
const CHAT_MAX_TOKENS = 2048;
const CHAT_RETRIES = 1;
const CHAT_RETRY_DELAY = 1000;

function buildSystemPrompt() {
  let projectSnapshot = '（暂无项目）';
  try {
    const db = getDb();
    const projects = db.prepare('SELECT id, name, enabled FROM projects ORDER BY created_at DESC LIMIT 20').all();
    if (projects.length > 0) {
      projectSnapshot = projects
        .map((p) => `- id=${p.id} 名称="${p.name}" ${p.enabled ? '(启用)' : '(禁用)'}`)
        .join('\n');
    }
  } catch (e) {
    projectSnapshot = '（读取项目列表失败）';
  }

  return `你是舆情监控系统的 AI 助手。你可以通过调用工具帮助用户完成配置、站点添加、项目管理、数据查询等操作。

## 当前项目快照
${projectSnapshot}
（上面快照中的项目 id 可直接用于需要 project_id 的工具，无需先调用 list_projects；若快照可能过期或没有目标项目，再调用 list_projects 确认。）

## 配置概念说明
- 站点（site）对象结构：{"platform": "平台名", "query": "site:域名"}，例如知乎：{"platform":"zhihu","query":"site:zhihu.com"}。
- RSS 源（rssSources）是字符串数组，可用 "{keyword}" 作为关键词占位符，例如 "https://news.google.com/rss?q=%22{keyword}%22"。
- 关键词（keywords）是字符串数组；采集参数在 keywordConfig 里（daysBack 回溯天数、todayOnly 是否只采今天）。

## 规则
1. 执行操作前确认好目标（优先使用上面快照里的项目 id），能用一次工具解决就不要多次往返。
2. 破坏性操作（删除项目、禁用项目、修改 LLM/邮件配置）必须先在回复中向用户说明将要执行的操作并明确请求确认，用户明确同意（如回复"确认""好的""同意"）后才调用对应工具。
3. 工具返回结果后，用简洁的中文向用户说明执行结果。
4. 不要编造数据，所有信息以工具返回结果为准。`;
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function mapError(error) {
  switch (error.code) {
    case 'LLM_NOT_CONFIGURED':
      return { message: '请先到「系统配置」页面填写 LLM 配置', code: error.code, status: 400 };
    case 'TIMEOUT':
      return { message: 'LLM 响应超时，可能是网关较慢，请重试', code: error.code, status: 504 };
    case 'NETWORK':
      return { message: '无法连接 LLM 服务，请检查网络与 Base URL', code: error.code, status: 502 };
    default:
      return { message: 'AI Chat 请求失败', code: error.code || 'UNKNOWN', status: 500, detail: error.message };
  }
}

async function runToolCalls(conversation, toolCalls, onStatus) {
  conversation.push({ role: 'assistant', content: null, tool_calls: toolCalls });
  if (onStatus) {
    onStatus(`正在调用：${toolCalls.map((t) => t.function.name).join('、')}`);
  }
  const results = await Promise.all(toolCalls.map((tc) => Promise.resolve().then(() => executeTool(tc))));
  for (let j = 0; j < toolCalls.length; j++) {
    conversation.push({
      role: 'tool',
      tool_call_id: toolCalls[j].id,
      content: JSON.stringify(results[j]),
    });
  }
}

router.post('/chat', async (req, res) => {
  const { messages, stream = true } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages 不能为空' } });
  }

  if (!stream) {
    try {
      const conversation = [{ role: 'system', content: buildSystemPrompt() }, ...messages];
      let finalContent = null;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const result = await chatCompletion({
          messages: conversation,
          tools: getToolDefinitions(),
          temperature: 0,
          maxTokens: CHAT_MAX_TOKENS,
          timeout: CHAT_TIMEOUT,
          retries: CHAT_RETRIES,
          retryDelay: CHAT_RETRY_DELAY,
        });

        if (result.tool_calls && result.tool_calls.length > 0) {
          await runToolCalls(conversation, result.tool_calls);
        } else {
          finalContent = result.content;
          break;
        }
      }

      if (!finalContent) {
        finalContent = '抱歉，我暂时无法完成这个请求，请稍后再试。';
      }
      return res.json({ content: finalContent });
    } catch (error) {
      const mapped = mapError(error);
      logger.error('AI Chat 请求失败', { error: error.message, code: error.code });
      return res.status(mapped.status).json({ error: { message: mapped.message, code: mapped.code, detail: mapped.detail } });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const conversation = [{ role: 'system', content: buildSystemPrompt() }, ...messages];
    let finalContent = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await chatCompletionStream({
        messages: conversation,
        tools: getToolDefinitions(),
        temperature: 0,
        maxTokens: CHAT_MAX_TOKENS,
        timeout: CHAT_TIMEOUT,
        retries: CHAT_RETRIES,
        retryDelay: CHAT_RETRY_DELAY,
        onToken: (delta) => sendSse(res, 'content', { delta }),
      });

      if (result.tool_calls && result.tool_calls.length > 0) {
        await runToolCalls(conversation, result.tool_calls, (text) => sendSse(res, 'status', { text }));
      } else {
        finalContent = result.content;
        break;
      }
    }

    if (!finalContent) {
      finalContent = '抱歉，我暂时无法完成这个请求，请稍后再试。';
    }
    sendSse(res, 'done', { content: finalContent });
    res.end();
  } catch (error) {
    const mapped = mapError(error);
    logger.error('AI Chat 请求失败', { error: error.message, code: error.code });
    sendSse(res, 'error', { message: mapped.message, code: mapped.code, detail: mapped.detail });
    res.end();
  }
});

module.exports = router;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/server/ai/chat.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: 运行后端全量测试确认无回归**

Run: `npx jest --runInBand tests/server`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add server/ai/chat.js tests/server/ai/chat.test.js
git commit -m "feat: AI Chat 支持 SSE 流式、项目快照注入与并行工具执行"
```

---

## Task 4: 前端流式（api.js chatStream + ChatWidget）

**Files:**
- Modify: `client/src/services/api.js`
- Modify: `client/src/components/ChatWidget.jsx`

- [ ] **Step 1: 修改 `client/src/services/api.js`**

把现有的 `aiApi` 块整体替换为：

```js
// AI 助手
export const aiApi = {
  chat: (messages) => api.post('/ai/chat', { messages, stream: false }),
  chatStream: (messages, { onStatus, onToken, onDone, onError } = {}) => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, stream: true }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          throw new Error(`请求失败 (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of rawEvent.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            let parsed;
            try { parsed = JSON.parse(data); } catch (e) { continue; }
            if (event === 'content' && onToken) onToken(parsed.delta);
            else if (event === 'status' && onStatus) onStatus(parsed.text);
            else if (event === 'done' && onDone) onDone(parsed.content);
            else if (event === 'error' && onError) onError(new Error(parsed.message));
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError' && onError) onError(e);
      }
    })();
    return controller;
  },
};
```

- [ ] **Step 2: 整体重写 `client/src/components/ChatWidget.jsx`**

```jsx
import { useState, useRef, useEffect } from 'react';
import { FloatButton, Card, Input, Button, Empty, Tag, message } from 'antd';
import { MessageOutlined, SendOutlined, CloseOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { aiApi } from '../services/api';

function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading, status]);

  const updateLastAssistant = (updater) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        next[next.length - 1] = updater(last);
      }
      return next;
    });
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;

    const history = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);
    setStatus('');

    aiApi.chatStream(history, {
      onStatus: (t) => setStatus(t),
      onToken: (delta) => {
        updateLastAssistant((last) => ({ ...last, content: last.content + delta }));
        setStatus('');
      },
      onDone: (content) => {
        updateLastAssistant((last) => (last.content ? last : { ...last, content: content || last.content }));
        setLoading(false);
        setStatus('');
      },
      onError: (err) => {
        updateLastAssistant((last) => ({
          ...last,
          content: last.content || `⚠️ ${err.message}`,
        }));
        message.error(err.message || '请求失败，请稍后重试');
        setLoading(false);
        setStatus('');
      },
    });
  };

  return (
    <>
      <FloatButton
        type="primary"
        icon={open ? <CloseOutlined /> : <MessageOutlined />}
        onClick={() => setOpen(!open)}
        style={{ right: 24, bottom: 24 }}
      />
      {open && (
        <Card
          title="AI 助手"
          size="small"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 80,
            width: 380,
            height: 520,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
          }}
          styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 } }}
        >
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {messages.length === 0 && (
              <Empty
                description="问我任何关于配置、站点、项目的问题"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: '12px',
                }}
              >
                {m.role === 'assistant' && <RobotOutlined style={{ marginRight: 8, color: '#1677ff' }} />}
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: m.role === 'user' ? '#1677ff' : '#f0f0f0',
                    color: m.role === 'user' ? '#fff' : '#000',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    minHeight: m.role === 'assistant' && !m.content ? 20 : undefined,
                  }}
                >
                  {m.content}
                  {m.role === 'assistant' && loading && i === messages.length - 1 && !m.content && '…'}
                </div>
                {m.role === 'user' && <UserOutlined style={{ marginLeft: 8, color: '#1677ff' }} />}
              </div>
            ))}
            {status && (
              <div style={{ marginBottom: '12px' }}>
                <Tag color="processing">{status}</Tag>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', padding: '12px', borderTop: '1px solid #f0f0f0' }}>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSend}
              placeholder="例如：给项目 1 添加知乎站点"
              disabled={loading}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={loading}
              style={{ marginLeft: 8 }}
            />
          </div>
        </Card>
      )}
    </>
  );
}

export default ChatWidget;
```

- [ ] **Step 3: 构建前端确认无编译错误**

Run: `cd client; if ($?) { npm run build }`
Expected: 构建成功（生成 `client/dist`）

- [ ] **Step 4: 提交**

```bash
git add client/src/services/api.js client/src/components/ChatWidget.jsx client/dist
git commit -m "feat: 前端 AI Chat 支持流式渲染与工具进度提示"
```

---

## Task 5: 全量验证

**Files:** 无（验证任务）

- [ ] **Step 1: 运行全量测试**

Run: `npx jest --runInBand tests/server`
Expected: 全部通过

- [ ] **Step 2: 重启服务验证**

停止旧的 `node server/index.js` 进程，重新启动：

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'server/index.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$p = Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory (Get-Location).Path -RedirectStandardOutput "data\server-out.log" -RedirectStandardError "data\server-err.log" -PassThru
Start-Sleep -Seconds 4
if ($p.HasExited) { "EXITED code=$($p.ExitCode)"; Get-Content data\server-err.log -Tail 20 } else { "RUNNING PID=$($p.Id)" }
```

Expected: `RUNNING PID=...`，浏览器访问 `http://localhost:3000`，右下角悬浮球可打开 AI 助手，发送消息能逐字流式返回并在调用工具时显示进度标签。

- [ ] **Step 3: 确认提交干净**

Run: `git status --short`
Expected: 无未提交的源代码改动。

---

## Self-Review 记录

- **Spec 覆盖**：A1 SSE 流式 → Task 1(chatCompletionStream)/Task 3(SSE 路由)/Task 4(前端)；A2 结果瘦身 → Task 2；A3 项目快照+领域说明+引导 → Task 3 `buildSystemPrompt`；A4 重试+错误分类 → Task 1(withRetry/normalizeError)+Task 3(mapError)；A5 并行工具 → Task 3 `runToolCalls`(Promise.all)；A6 maxTokens 2048 → Task 3 `CHAT_MAX_TOKENS`。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`chatCompletionStream({... onToken})` 返回 `{content, tool_calls}`；`runToolCalls(conversation, toolCalls, onStatus)`；`aiApi.chatStream(messages, {onStatus,onToken,onDone,onError})`；SSE 事件 `status/content/done/error` 前后端命名一致。
