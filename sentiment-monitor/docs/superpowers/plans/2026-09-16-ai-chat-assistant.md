# AI Chat 助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在舆情监控系统 Web UI 中新增一个全局悬浮 AI Chat，通过自然语言执行配置修改、站点添加、项目管理等操作。

**Architecture:** 后端新增 `server/ai/` 模块（共享 LLM client + 工具注册表 + 工具调用循环路由），复用系统已有 LLM 配置（`config` 表 `llm_config`）。前端新增全局悬浮聊天组件，调用 `POST /api/ai/chat`。

**Tech Stack:** Node.js + Express + better-sqlite3，前端 React 18 + antd 5 + axios，测试 jest + supertest。

---

## 文件结构

**后端（新增）**
- `server/ai/llmClient.js` — 共享 LLM 客户端：`getLLMConfig()` + `chatCompletion()`（支持 `config` 覆盖、`tools` 参数）
- `server/ai/tools.js` — 工具注册表：24 个工具的 JSON Schema + 执行器
- `server/ai/chat.js` — `POST /api/ai/chat` 路由 + 工具调用循环

**后端（修改）**
- `server/index.js` — 挂载 `/api/ai` 路由
- `server/relevanceChecker.js` — 改用共享 llmClient，删除重复代码
- `server/api/config.js` — `/llm/test` 改用共享 llmClient

**前端（修改）**
- `client/src/services/api.js` — 新增 `aiApi`
- `client/src/components/ChatWidget.jsx` — 悬浮聊天组件（新增）
- `client/src/components/Layout.jsx` — 挂载 ChatWidget

**测试（新增）**
- `tests/server/ai/llmClient.test.js`
- `tests/server/ai/tools.test.js`
- `tests/server/ai/chat.test.js`

---

## Task 1: 共享 LLM 客户端 `llmClient.js`

**Files:**
- Create: `server/ai/llmClient.js`
- Test: `tests/server/ai/llmClient.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/ai/llmClient.test.js`：

```js
const { getDb } = require('../../../server/db');
const { getLLMConfig, chatCompletion } = require('../../../server/ai/llmClient');

describe('llmClient', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec("DELETE FROM config WHERE key = 'llm_config'");
  });

  afterAll(() => {
    db.close();
  });

  it('getLLMConfig 未配置时返回 null', () => {
    expect(getLLMConfig()).toBeNull();
  });

  it('getLLMConfig 返回解析后的配置', () => {
    db.prepare("INSERT INTO config (key, value) VALUES ('llm_config', ?)")
      .run(JSON.stringify({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-3.5-turbo', enabled: true }));

    const cfg = getLLMConfig();
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.model).toBe('gpt-3.5-turbo');
    expect(cfg.enabled).toBe(true);
  });

  it('chatCompletion 未配置时抛出 LLM_NOT_CONFIGURED', async () => {
    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server/ai/llmClient.test.js`
Expected: FAIL（`Cannot find module '../../../server/ai/llmClient'`）

- [ ] **Step 3: 实现 llmClient**

创建 `server/ai/llmClient.js`：

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

async function chatCompletion({ messages, tools, temperature = 0, maxTokens = 1024, config }) {
  const llmConfig = config || getLLMConfig();

  if (!llmConfig || !llmConfig.enabled || !llmConfig.apiKey) {
    const error = new Error('LLM 未配置或未启用');
    error.code = 'LLM_NOT_CONFIGURED';
    throw error;
  }

  const body = {
    model: llmConfig.model || 'gpt-3.5-turbo',
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const postData = JSON.stringify(body);
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const url = new URL(`${baseUrl}/chat/completions`);

  const response = await new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmConfig.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: LLM_TIMEOUT,
    };

    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LLM request timeout'));
    });

    req.write(postData);
    req.end();
  });

  if (response.statusCode !== 200) {
    let detail = response.body;
    try {
      const json = JSON.parse(response.body);
      detail = json.error?.message || response.body;
    } catch (e) {
      // ignore parse error, keep raw body
    }
    const error = new Error(`LLM 调用失败: ${detail}`);
    error.statusCode = response.statusCode;
    throw error;
  }

  const json = JSON.parse(response.body);
  const message = json.choices?.[0]?.message || {};

  return {
    content: (message.content || '').trim(),
    tool_calls: message.tool_calls || [],
  };
}

module.exports = { getLLMConfig, chatCompletion };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/server/ai/llmClient.test.js`
Expected: PASS（3 tests passed）

- [ ] **Step 5: 提交**

```bash
git add server/ai/llmClient.js tests/server/ai/llmClient.test.js
git commit -m "feat: 新增共享 LLM 客户端 llmClient"
```

---

## Task 2: 重构 `relevanceChecker.js` 复用 llmClient

**Files:**
- Modify: `server/relevanceChecker.js`

- [ ] **Step 1: 编辑文件**

删除文件顶部 `const https = require('https');`、`const http = require('http');`、`const LLM_TIMEOUT = 15000;`、`getLLMConfig` 函数（原 17-30 行）和旧的 `callLLM` 函数（原 35-95 行）。在 `const { getDb } = require('./db');` 与 `const logger = require('./logger');` 之后加入：

```js
const { getLLMConfig, chatCompletion } = require('./ai/llmClient');
```

新增简化的 `callLLM`：

```js
async function callLLM(prompt, systemPrompt) {
  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      maxTokens: 10,
    });
    return result.content || null;
  } catch (e) {
    if (e.code === 'LLM_NOT_CONFIGURED') {
      return null;
    }
    throw e;
  }
}
```

编辑后文件顶部应为（`checkRelevance` 及其后的代码保持不变）：

```js
/**
 * 内容相关性检查模块
 * 使用 LLM 判断采集内容是否与关键词相关
 */

const { getDb } = require('./db');
const logger = require('./logger');
const { getLLMConfig, chatCompletion } = require('./ai/llmClient');

async function callLLM(prompt, systemPrompt) {
  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      maxTokens: 10,
    });
    return result.content || null;
  } catch (e) {
    if (e.code === 'LLM_NOT_CONFIGURED') {
      return null;
    }
    throw e;
  }
}
```

- [ ] **Step 2: 运行现有测试确认无回归**

Run: `npx jest tests/server`
Expected: PASS（projects / health 等现有测试仍通过）

- [ ] **Step 3: 提交**

```bash
git add server/relevanceChecker.js
git commit -m "refactor: relevanceChecker 复用共享 LLM 客户端"
```

---

## Task 3: 重构 `config.js` 的 LLM 测试接口

**Files:**
- Modify: `server/api/config.js`

- [ ] **Step 1: 编辑文件**

在 `const logger = require('../logger');` 之后加入：

```js
const llmClient = require('../ai/llmClient');
```

将原 `router.post('/llm/test', ...)` 处理器（第 61-133 行）整体替换为：

```js
router.post('/llm/test', async (req, res) => {
  const { apiKey, baseUrl, model } = req.body;

  if (!apiKey || !baseUrl || !model) {
    return res.status(400).json({ error: { message: '缺少必要参数' } });
  }

  try {
    const result = await llmClient.chatCompletion({
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
      maxTokens: 5,
      config: { apiKey, baseUrl, model, enabled: true },
    });

    logger.info('LLM 连接测试成功', { model });
    res.json({ success: true, message: '连接成功', response: result.content });
  } catch (error) {
    logger.warn('LLM 连接测试失败', { error: error.message });
    res.status(error.statusCode || 400).json({ error: { message: '连接失败', detail: error.message } });
  }
});
```

- [ ] **Step 2: 运行现有测试确认无回归**

Run: `npx jest tests/server`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/api/config.js
git commit -m "refactor: config LLM 测试接口复用共享客户端"
```

---

## Task 4: 工具注册表 `tools.js`

**Files:**
- Create: `server/ai/tools.js`
- Test: `tests/server/ai/tools.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/ai/tools.test.js`：

```js
const { getDb } = require('../../../server/db');
const { executeTool, getToolDefinitions } = require('../../../server/ai/tools');

describe('AI Tools', () => {
  let db;
  let projectId;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM projects');
    const result = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run('ai-test', JSON.stringify({
        keywords: ['OpenAN'],
        sites: [{ platform: 'zhihu', query: 'site:zhihu.com' }],
        rssSources: ['https://example.com/rss'],
        keywordConfig: { daysBack: 3, todayOnly: false },
      }));
    projectId = result.lastInsertRowid;
  });

  afterAll(() => {
    db.close();
  });

  const call = (name, args) =>
    executeTool({ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } });

  const readConfig = (id) =>
    JSON.parse(db.prepare('SELECT config FROM projects WHERE id = ?').get(id).config);

  it('add_site 添加站点', () => {
    const res = call('add_site', { project_id: projectId, platform: 'weibo', query: 'site:weibo.com' });
    expect(res.success).toBe(true);
    expect(readConfig(projectId).sites).toContainEqual({ platform: 'weibo', query: 'site:weibo.com' });
  });

  it('remove_site 删除站点', () => {
    const res = call('remove_site', { project_id: projectId, platform: 'zhihu' });
    expect(res.success).toBe(true);
    expect(readConfig(projectId).sites).toHaveLength(0);
  });

  it('add_keyword 添加关键词并去重', () => {
    call('add_keyword', { project_id: projectId, keyword: 'OpenAN' });
    call('add_keyword', { project_id: projectId, keyword: 'NewKW' });
    expect(readConfig(projectId).keywords).toEqual(['OpenAN', 'NewKW']);
  });

  it('update_collection_config 修改 daysBack', () => {
    const res = call('update_collection_config', { project_id: projectId, daysBack: 7 });
    expect(res.success).toBe(true);
    expect(readConfig(projectId).keywordConfig.daysBack).toBe(7);
  });

  it('delete_project 无 confirm 时拒绝', () => {
    const res = call('delete_project', { project_id: projectId });
    expect(res.success).toBe(false);
    expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)).toBeDefined();
  });

  it('delete_project confirm=true 删除项目', () => {
    const res = call('delete_project', { project_id: projectId, confirm: true });
    expect(res.success).toBe(true);
    expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)).toBeUndefined();
  });

  it('getToolDefinitions 返回 type=function 定义', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server/ai/tools.test.js`
Expected: FAIL（`Cannot find module '../../../server/ai/tools'`）

- [ ] **Step 3: 实现 tools.js**

创建 `server/ai/tools.js`：

```js
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const logger = require('../logger');
const scheduler = require('../scheduler');
const notifier = require('../notifier');

const RULES_PATH = path.join(__dirname, '../../config/decision-rules.json');
const LOG_DIR = path.join(__dirname, '../../data');

function getProject(db, id) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return null;
  let config = {};
  try {
    config = JSON.parse(project.config || '{}');
  } catch (e) {
    config = {};
  }
  return { ...project, config };
}

function saveProjectConfig(db, id, config) {
  db.prepare('UPDATE projects SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(config), id);
}

function requireProjectId(args) {
  const id = parseInt(args.project_id, 10);
  if (!id) throw new Error('缺少有效的 project_id');
  return id;
}

const tools = [
  // ---- 项目监控配置 ----
  {
    name: 'add_keyword',
    description: '向指定项目添加监控关键词',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        keyword: { type: 'string', description: '关键词' },
      },
      required: ['project_id', 'keyword'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      if (!args.keyword) throw new Error('keyword 必填');
      const keywords = Array.isArray(project.config.keywords) ? project.config.keywords : [];
      if (!keywords.includes(args.keyword)) keywords.push(args.keyword);
      saveProjectConfig(db, id, { ...project.config, keywords });
      scheduler.restart();
      return { project_id: id, keywords };
    },
  },
  {
    name: 'remove_keyword',
    description: '从指定项目移除监控关键词',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        keyword: { type: 'string', description: '关键词' },
      },
      required: ['project_id', 'keyword'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      const keywords = (Array.isArray(project.config.keywords) ? project.config.keywords : [])
        .filter((k) => k !== args.keyword);
      saveProjectConfig(db, id, { ...project.config, keywords });
      scheduler.restart();
      return { project_id: id, keywords };
    },
  },
  {
    name: 'add_site',
    description: '向指定项目添加一个定向站点（platform + query，如 site:weibo.com）',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        platform: { type: 'string', description: '平台名，如 weibo/zhihu/csdn' },
        query: { type: 'string', description: '搜索 query，如 site:weibo.com' },
      },
      required: ['project_id', 'platform', 'query'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      if (!args.platform || !args.query) throw new Error('platform 和 query 必填');
      const sites = Array.isArray(project.config.sites) ? project.config.sites : [];
      const existing = sites.find((s) => s.platform === args.platform);
      if (existing) {
        existing.query = args.query;
      } else {
        sites.push({ platform: args.platform, query: args.query });
      }
      saveProjectConfig(db, id, { ...project.config, sites });
      scheduler.restart();
      return { project_id: id, sites };
    },
  },
  {
    name: 'remove_site',
    description: '从指定项目移除一个定向站点',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        platform: { type: 'string', description: '要移除的平台名' },
      },
      required: ['project_id', 'platform'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      const sites = (Array.isArray(project.config.sites) ? project.config.sites : [])
        .filter((s) => s.platform !== args.platform);
      saveProjectConfig(db, id, { ...project.config, sites });
      scheduler.restart();
      return { project_id: id, sites };
    },
  },
  {
    name: 'add_rss_source',
    description: '向指定项目添加一个 RSS 源 URL',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        url: { type: 'string', description: 'RSS 源 URL' },
      },
      required: ['project_id', 'url'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      if (!args.url) throw new Error('url 必填');
      const rssSources = Array.isArray(project.config.rssSources) ? project.config.rssSources : [];
      if (!rssSources.includes(args.url)) rssSources.push(args.url);
      saveProjectConfig(db, id, { ...project.config, rssSources });
      scheduler.restart();
      return { project_id: id, rssSources };
    },
  },
  {
    name: 'remove_rss_source',
    description: '从指定项目移除一个 RSS 源 URL',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        url: { type: 'string', description: 'RSS 源 URL' },
      },
      required: ['project_id', 'url'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      const rssSources = (Array.isArray(project.config.rssSources) ? project.config.rssSources : [])
        .filter((u) => u !== args.url);
      saveProjectConfig(db, id, { ...project.config, rssSources });
      scheduler.restart();
      return { project_id: id, rssSources };
    },
  },
  {
    name: 'update_collection_config',
    description: '更新项目采集参数（daysBack / todayOnly / searchVariants）',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        daysBack: { type: 'number', description: '回溯天数' },
        todayOnly: { type: 'boolean', description: '是否只采集今天' },
        searchVariants: { type: 'array', items: { type: 'string' }, description: '搜索变体模板数组' },
      },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      const keywordConfig = { ...(project.config.keywordConfig || {}) };
      if (args.daysBack !== undefined) keywordConfig.daysBack = args.daysBack;
      if (args.todayOnly !== undefined) keywordConfig.todayOnly = !!args.todayOnly;
      const next = { ...project.config, keywordConfig };
      if (args.searchVariants !== undefined) {
        if (!Array.isArray(args.searchVariants)) throw new Error('searchVariants 必须是数组');
        next.searchVariants = args.searchVariants;
      }
      saveProjectConfig(db, id, next);
      scheduler.restart();
      return { project_id: id, keywordConfig: next.keywordConfig, searchVariants: next.searchVariants };
    },
  },

  // ---- 项目管理 ----
  {
    name: 'list_projects',
    description: '列出所有监控项目',
    parameters: { type: 'object', properties: {} },
    execute() {
      const db = getDb();
      return db.prepare('SELECT id, name, enabled, created_at, updated_at FROM projects ORDER BY created_at DESC').all();
    },
  },
  {
    name: 'get_project',
    description: '获取指定项目的完整信息（含配置）',
    parameters: {
      type: 'object',
      properties: { project_id: { type: 'number', description: '项目 ID' } },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      return project;
    },
  },
  {
    name: 'create_project',
    description: '创建新的监控项目',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称（唯一）' },
        keywords: { type: 'array', items: { type: 'string' }, description: '初始关键词列表' },
        config: { type: 'object', description: '完整的项目配置对象（可选）' },
      },
      required: ['name'],
    },
    execute(args) {
      const db = getDb();
      if (!args.name) throw new Error('项目名称必填');
      const config = args.config && typeof args.config === 'object' ? args.config : {};
      if (Array.isArray(args.keywords)) config.keywords = args.keywords;
      try {
        const result = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
          .run(args.name, JSON.stringify(config));
        scheduler.restart();
        return { id: result.lastInsertRowid, name: args.name, config };
      } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
          throw new Error(`项目名称 "${args.name}" 已存在`);
        }
        throw e;
      }
    },
  },
  {
    name: 'update_project',
    description: '更新项目名称或启用状态',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        name: { type: 'string', description: '新的项目名称' },
        enabled: { type: 'boolean', description: '是否启用' },
      },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = getProject(db, id);
      if (!project) throw new Error('项目不存在');
      const updates = [];
      const values = [];
      if (args.name !== undefined) { updates.push('name = ?'); values.push(args.name); }
      if (args.enabled !== undefined) { updates.push('enabled = ?'); values.push(args.enabled ? 1 : 0); }
      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        scheduler.restart();
      }
      return getProject(db, id);
    },
  },
  {
    name: 'delete_project',
    description: '删除项目（破坏性操作，需 confirm=true）',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        confirm: { type: 'boolean', description: '必须为 true 才会执行删除' },
      },
      required: ['project_id', 'confirm'],
    },
    execute(args) {
      if (args.confirm !== true) throw new Error('删除项目是破坏性操作，需要 confirm=true 确认');
      const db = getDb();
      const id = requireProjectId(args);
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!project) throw new Error('项目不存在');
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      notifier.clearCache(id);
      scheduler.restart();
      return { success: true, message: `项目 "${project.name}" 已删除` };
    },
  },
  {
    name: 'enable_project',
    description: '启用项目',
    parameters: {
      type: 'object',
      properties: { project_id: { type: 'number', description: '项目 ID' } },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const result = db.prepare('UPDATE projects SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      if (result.changes === 0) throw new Error('项目不存在');
      scheduler.restart();
      return { success: true, project_id: id };
    },
  },
  {
    name: 'disable_project',
    description: '禁用项目（会停止其定时采集）',
    parameters: {
      type: 'object',
      properties: { project_id: { type: 'number', description: '项目 ID' } },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const result = db.prepare('UPDATE projects SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      if (result.changes === 0) throw new Error('项目不存在');
      scheduler.restart();
      return { success: true, project_id: id };
    },
  },

  // ---- 全局配置 ----
  {
    name: 'get_config',
    description: '获取全局配置（决策规则、LLM、邮件；敏感字段已脱敏）',
    parameters: { type: 'object', properties: {} },
    execute() {
      const db = getDb();
      let rules = {};
      try { rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8')); } catch (e) { rules = {}; }

      let llm = { enabled: false };
      const llmRow = db.prepare("SELECT value FROM config WHERE key = 'llm_config'").get();
      if (llmRow) {
        try {
          llm = JSON.parse(llmRow.value);
          if (llm.apiKey) llm.apiKey = '***' + llm.apiKey.slice(-4);
        } catch (e) { llm = { enabled: false }; }
      }

      let email = { enabled: false };
      const emailRow = db.prepare("SELECT value FROM config WHERE key = 'email_config'").get();
      if (emailRow) {
        try {
          email = JSON.parse(emailRow.value);
          if (email.password) email.password = '***';
        } catch (e) { email = { enabled: false }; }
      }

      return { rules, llm, email };
    },
  },
  {
    name: 'update_config_rules',
    description: '更新决策规则（sourceHealth / contentQuality）',
    parameters: {
      type: 'object',
      properties: { rules: { type: 'object', description: '完整决策规则对象' } },
      required: ['rules'],
    },
    execute(args) {
      if (!args.rules || typeof args.rules !== 'object') throw new Error('缺少 rules 配置');
      fs.writeFileSync(RULES_PATH, JSON.stringify(args.rules, null, 2));
      return { success: true };
    },
  },
  {
    name: 'update_llm_config',
    description: '更新 LLM 配置（apiKey/baseUrl/model/enabled）',
    parameters: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'API Key' },
        baseUrl: { type: 'string', description: 'Base URL' },
        model: { type: 'string', description: '模型名' },
        enabled: { type: 'boolean', description: '是否启用' },
      },
    },
    execute(args) {
      const db = getDb();
      const row = db.prepare("SELECT value FROM config WHERE key = 'llm_config'").get();
      let current = { enabled: false };
      if (row) { try { current = JSON.parse(row.value); } catch (e) { current = { enabled: false }; } }

      const next = {
        apiKey: args.apiKey !== undefined ? args.apiKey : current.apiKey,
        baseUrl: args.baseUrl !== undefined ? args.baseUrl : current.baseUrl,
        model: args.model !== undefined ? args.model : current.model,
        enabled: args.enabled !== undefined ? !!args.enabled : !!current.enabled,
      };
      if (next.apiKey && next.apiKey.startsWith('***')) next.apiKey = current.apiKey;

      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('llm_config', ?)").run(JSON.stringify(next));
      return { success: true, model: next.model, enabled: next.enabled };
    },
  },
  {
    name: 'update_email_config',
    description: '更新全局邮件配置',
    parameters: {
      type: 'object',
      properties: { email: { type: 'object', description: '完整邮件配置对象' } },
      required: ['email'],
    },
    execute(args) {
      if (!args.email || typeof args.email !== 'object') throw new Error('缺少 email 配置');
      const db = getDb();
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('email_config', ?)").run(JSON.stringify(args.email));
      return { success: true };
    },
  },

  // ---- 查询 / 触发 ----
  {
    name: 'trigger_collection',
    description: '手动触发指定项目的采集',
    parameters: {
      type: 'object',
      properties: { project_id: { type: 'number', description: '项目 ID' } },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (!project) throw new Error('项目不存在');
      scheduler.triggerManualCollection(id)
        .then(() => logger.info('AI 触发采集完成', { projectId: id }))
        .catch((e) => logger.error('AI 触发采集失败', { projectId: id, error: e.message }));
      return { success: true, message: '采集任务已启动', project_id: id };
    },
  },
  {
    name: 'get_scheduler_status',
    description: '获取调度器运行状态',
    parameters: { type: 'object', properties: {} },
    execute() {
      return scheduler.getStatus();
    },
  },
  {
    name: 'list_items',
    description: '查询指定项目最近的采集条目',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' },
        limit: { type: 'number', description: '条数，默认 20' },
      },
      required: ['project_id'],
    },
    execute(args) {
      const db = getDb();
      const id = requireProjectId(args);
      const limit = parseInt(args.limit, 10) || 20;
      const items = db.prepare(
        'SELECT id, source, source_type, title, url, risk_level, sentiment, timestamp FROM items WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(id, limit);
      return { count: items.length, items };
    },
  },
  {
    name: 'list_collection_history',
    description: '查询采集历史记录',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID（可选）' },
        limit: { type: 'number', description: '条数，默认 20' },
      },
    },
    execute(args) {
      const db = getDb();
      const limit = parseInt(args.limit, 10) || 20;
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
  {
    name: 'list_decisions',
    description: '查询决策记录',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID（可选）' },
        limit: { type: 'number', description: '条数，默认 20' },
      },
    },
    execute(args) {
      const db = getDb();
      const limit = parseInt(args.limit, 10) || 20;
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
  {
    name: 'list_logs',
    description: '查看最近的运行日志',
    parameters: {
      type: 'object',
      properties: { lines: { type: 'number', description: '返回最近 N 行，默认 30' } },
    },
    execute(args) {
      const lines = parseInt(args.lines, 10) || 30;
      const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).sort();
      const appLog = files.filter((f) => /^app-.*\.log$/.test(f)).sort().pop();
      let tail = [];
      if (appLog) {
        const content = fs.readFileSync(path.join(LOG_DIR, appLog), 'utf-8');
        tail = content.split('\n').filter((l) => l.trim()).slice(-lines);
      }
      return { files, latestFile: appLog || null, tail };
    },
  },
];

function getToolDefinitions() {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function executeTool(toolCall) {
  const name = toolCall.function?.name;
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    return { success: false, error: `未知工具: ${name}` };
  }

  let args;
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    return { success: false, error: `工具参数解析失败: ${e.message}` };
  }

  try {
    const result = tool.execute(args);
    return { success: true, result };
  } catch (e) {
    logger.error('工具执行失败', { name, error: e.message });
    return { success: false, error: e.message };
  }
}

module.exports = { tools, getToolDefinitions, executeTool };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/server/ai/tools.test.js`
Expected: PASS（8 tests passed）

- [ ] **Step 5: 提交**

```bash
git add server/ai/tools.js tests/server/ai/tools.test.js
git commit -m "feat: 新增 AI 工具注册表（配置/项目/查询工具）"
```

---

## Task 5: AI Chat 路由 `chat.js`

**Files:**
- Create: `server/ai/chat.js`
- Test: `tests/server/ai/chat.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/ai/chat.test.js`：

```js
jest.mock('../../../server/ai/llmClient');

const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');
const { chatCompletion } = require('../../../server/ai/llmClient');

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

  it('应执行工具调用并返回最终回答', async () => {
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
      .send({ messages: [{ role: 'user', content: '有哪些项目？' }] })
      .expect(200);

    expect(res.body.content).toBe('当前没有项目。');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('未配置 LLM 时返回 400', async () => {
    const err = new Error('LLM 未配置');
    err.code = 'LLM_NOT_CONFIGURED';
    chatCompletion.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(400);

    expect(res.body.error.message).toContain('LLM');
  });

  it('messages 为空时返回 400', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [] })
      .expect(400);

    expect(res.body.error.message).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server/ai/chat.test.js`
Expected: FAIL（`Cannot find module '../../../server/ai/chat'` 或路由 404）

- [ ] **Step 3: 实现 chat.js**

创建 `server/ai/chat.js`：

```js
const express = require('express');
const { chatCompletion } = require('./llmClient');
const { getToolDefinitions, executeTool } = require('./tools');
const logger = require('../logger');

const router = express.Router();

const SYSTEM_PROMPT = `你是舆情监控系统的 AI 助手。你可以通过调用工具来帮助用户完成配置、站点添加、项目管理、数据查询等操作。

重要规则：
1. 在执行任何操作前，先用工具查询当前状态（如 list_projects 获取项目 ID），确认无误后再执行。
2. 破坏性操作（删除项目、禁用项目、修改 LLM/邮件配置）必须先在回复中向用户说明将要执行的操作，并明确请求用户确认。只有在用户明确同意（如回复"确认""好的""同意"）后，才能调用对应工具。
3. 工具返回结果后，用简洁的中文向用户说明执行结果。
4. 不要编造数据，所有信息以工具返回结果为准。`;

const MAX_ITERATIONS = 6;

router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages 不能为空' } });
    }

    const conversation = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    let finalContent = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await chatCompletion({
        messages: conversation,
        tools: getToolDefinitions(),
        temperature: 0,
      });

      if (result.tool_calls && result.tool_calls.length > 0) {
        conversation.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.tool_calls,
        });

        for (const toolCall of result.tool_calls) {
          const toolResult = executeTool(toolCall);
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
      } else {
        finalContent = result.content;
        break;
      }
    }

    if (!finalContent) {
      finalContent = '抱歉，我暂时无法完成这个请求，请稍后再试。';
    }

    res.json({ content: finalContent });
  } catch (error) {
    if (error.code === 'LLM_NOT_CONFIGURED') {
      return res.status(400).json({ error: { message: '请先到「系统配置」页面填写 LLM 配置' } });
    }
    logger.error('AI Chat 请求失败', { error: error.message });
    res.status(500).json({ error: { message: 'AI Chat 请求失败', detail: error.message } });
  }
});

module.exports = router;
```

- [ ] **Step 4: 在 server/index.js 挂载路由**

编辑 `server/index.js`，在 `const scheduler = require('./scheduler');` 之后加入：

```js
const chatRouter = require('./ai/chat');
```

在 `app.use('/api/logs', logsRouter);` 之后加入：

```js
app.use('/api/ai', chatRouter);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest tests/server/ai/chat.test.js`
Expected: PASS（3 tests passed）

- [ ] **Step 6: 运行全量后端测试确认无回归**

Run: `npx jest tests/server`
Expected: PASS（全部通过）

- [ ] **Step 7: 提交**

```bash
git add server/ai/chat.js server/index.js tests/server/ai/chat.test.js
git commit -m "feat: 新增 AI Chat 路由与工具调用循环"
```

---

## Task 6: 前端 API 封装

**Files:**
- Modify: `client/src/services/api.js`

- [ ] **Step 1: 编辑文件**

在 `client/src/services/api.js` 文件末尾（`export default api;` 之前）加入：

```js
// AI 助手
export const aiApi = {
  chat: (messages) => api.post('/ai/chat', { messages }),
};
```

- [ ] **Step 2: 提交**

```bash
git add client/src/services/api.js
git commit -m "feat: 前端新增 aiApi 封装"
```

---

## Task 7: 全局悬浮聊天组件 `ChatWidget`

**Files:**
- Create: `client/src/components/ChatWidget.jsx`
- Modify: `client/src/components/Layout.jsx`

- [ ] **Step 1: 创建 ChatWidget**

创建 `client/src/components/ChatWidget.jsx`：

```jsx
import { useState, useRef, useEffect } from 'react';
import { FloatButton, Card, Input, Button, Spin, Empty, message } from 'antd';
import { MessageOutlined, SendOutlined, CloseOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { aiApi } from '../services/api';

function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await aiApi.chat(nextMessages);
      setMessages([...nextMessages, { role: 'assistant', content: res.data.content }]);
    } catch (error) {
      const detail = error.response?.data?.error?.message || '请求失败，请稍后重试';
      message.error(detail);
      setMessages([...nextMessages, { role: 'assistant', content: `⚠️ ${detail}` }]);
    } finally {
      setLoading(false);
    }
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
                  }}
                >
                  {m.content}
                </div>
                {m.role === 'user' && <UserOutlined style={{ marginLeft: 8, color: '#1677ff' }} />}
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
                <Spin size="small" style={{ marginLeft: 4 }} />
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

- [ ] **Step 2: 挂载到 Layout**

编辑 `client/src/components/Layout.jsx`：

在文件顶部 `import { Link, useLocation, Outlet } from 'react-router-dom';` 之后加入：

```js
import ChatWidget from './ChatWidget';
```

在 JSX 中，把 `<ChatWidget />` 加到最外层 `<Layout>` 的最后一个子节点（内层 `<Layout>` 闭合之后、最外层 `</Layout>` 之前）：

```jsx
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Sentiment Monitor</h2>
        </Header>
        <Content style={{ margin: '24px 16px', padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
      <ChatWidget />
    </Layout>
```

- [ ] **Step 3: 构建前端确认无编译错误**

Run: `cd client; if ($?) { npm run build }`
Expected: 构建成功（生成 `client/dist`）

- [ ] **Step 4: 提交**

```bash
git add client/src/components/ChatWidget.jsx client/src/components/Layout.jsx
git commit -m "feat: 前端新增全局悬浮 AI Chat 组件"
```

---

## Task 8: 全量验证

**Files:** 无（验证任务）

- [ ] **Step 1: 运行全量测试**

Run: `npx jest`
Expected: 全部测试通过（现有 tests + 新增 ai 测试）

- [ ] **Step 2: 重启本地服务验证**

停止旧的 `node server/index.js` 进程（若有），重新启动：

```powershell
$p = Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory (Get-Location).Path -RedirectStandardOutput "data\server-out.log" -RedirectStandardError "data\server-err.log" -PassThru
Start-Sleep -Seconds 4
try { Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 5 | Select-Object StatusCode } catch { $_.Exception.Message }
```

Expected: `StatusCode = 200`，浏览器访问 `http://localhost:3000` 右下角出现悬浮球。

- [ ] **Step 3: 确认提交干净**

Run: `git status --short`
Expected: 无未提交的源代码改动（除预期文件外）。

---

## Self-Review 记录

- **Spec 覆盖**：方案 C（共享 llmClient + 工具循环）→ Task 1/2/3；24 个工具 → Task 4；`/api/ai/chat` 循环 → Task 5；安全边界（confirm 参数 + 系统提示确认）→ Task 4/5；前端悬浮组件 → Task 6/7；错误处理 → 各任务内联；测试 → 每个任务。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`chatCompletion({ messages, tools, temperature, maxTokens, config })`、`getLLMConfig()`、`getToolDefinitions()`、`executeTool(toolCall)`、`aiApi.chat(messages)` 在各任务中命名一致。
