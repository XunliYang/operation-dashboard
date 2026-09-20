const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const logger = require('../logger');
const scheduler = require('../scheduler');
const notifier = require('../notifier');

const RULES_PATH = path.join(__dirname, '../../config/decision-rules.json');
const LOG_DIR = path.join(__dirname, '../../data');

function truncate(str, max) {
  if (str == null) return str;
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

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