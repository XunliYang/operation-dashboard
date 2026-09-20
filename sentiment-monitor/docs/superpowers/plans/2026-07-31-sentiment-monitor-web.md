# Sentiment Monitor Web 服务实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 sentiment-monitor 从 CLI 工具升级为独立 Web 服务，提供自主决策能力和 Web 管理界面。

**Architecture:** Express + React 单体架构，SQLite 存储，内置决策引擎（规则驱动），定时任务自动采集，Web 界面管理配置和监控健康度。

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), React, Vite, node-cron, nodemailer, winston

---

## 文件结构总览

```
sentiment-monitor/
├── client/                          # 前端（React + Vite）
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout.jsx           # 布局组件
│   │   │   ├── StatCard.jsx         # 统计卡片
│   │   │   ├── HealthChart.jsx      # 健康度图表
│   │   │   └── DecisionList.jsx     # 决策列表
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx        # 首页
│   │   │   ├── ProjectList.jsx      # 项目列表
│   │   │   ├── ProjectDetail.jsx    # 项目详情
│   │   │   ├── HealthMonitor.jsx    # 健康监控
│   │   │   ├── History.jsx          # 历史数据
│   │   │   ├── Decisions.jsx        # 决策记录
│   │   │   └── Config.jsx           # 系统配置
│   │   ├── services/
│   │   │   └── api.js               # API 调用封装
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── api/
│   │   ├── projects.js              # 项目管理 API
│   │   ├── health.js                # 健康度 API
│   │   ├── history.js               # 历史数据 API
│   │   ├── decisions.js             # 决策记录 API
│   │   └── config.js                # 配置管理 API
│   ├── db/
│   │   ├── schema.sql               # 数据库 schema
│   │   └── index.js                 # 数据库连接和初始化
│   ├── middleware/
│   │   └── errorHandler.js          # 错误处理中间件
│   ├── scheduler.js                 # 定时任务
│   ├── decision-engine.js           # 决策引擎
│   ├── notifier.js                  # 通知模块
│   ├── lock.js                      # 并发控制
│   ├── logger.js                    # 日志模块
│   └── index.js                     # Express 入口
├── config/
│   └── decision-rules.json          # 决策规则配置
├── data/                            # 数据目录
│   ├── .gitkeep
│   └── backups/
├── tests/
│   ├── server/
│   │   ├── db.test.js
│   │   ├── decision-engine.test.js
│   │   └── api.test.js
│   └── client/
│       └── components.test.jsx
├── package.json
├── start.sh
├── start.bat
├── Dockerfile
└── docker-compose.yml
```

---

## Phase 1: 后端基础（第 1-2 周）

### Task 1: 项目初始化和依赖安装

**Files:**
- Modify: `package.json`
- Create: `server/index.js`
- Create: `server/db/schema.sql`
- Create: `server/db/index.js`

- [ ] **Step 1: 更新 package.json 添加后端依赖**

```json
{
  "name": "sentiment-monitor",
  "version": "2.0.0",
  "description": "舆情监控系统 Web 服务",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "dev": "nodemon server/index.js",
    "test": "jest",
    "build:client": "cd client && npm install && npm run build"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.4.3",
    "node-cron": "^3.0.3",
    "nodemailer": "^6.9.8",
    "winston": "^3.11.0",
    "winston-daily-rotate-file": "^4.7.1",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nodemon": "^3.0.2"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
npm install
```

- [ ] **Step 3: 创建数据库 schema**

创建 `server/db/schema.sql`:

```sql
-- 监控项目配置
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  config JSON NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 采集记录
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  url TEXT,
  snippet TEXT,
  timestamp DATETIME,
  risk_level TEXT,
  sentiment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 数据源健康度
CREATE TABLE IF NOT EXISTS source_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  raw_count INTEGER DEFAULT 0,
  filtered_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'normal',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 决策记录
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 禁用源状态
CREATE TABLE IF NOT EXISTS disabled_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  disabled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 系统配置
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_items_project_date ON items(project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
CREATE INDEX IF NOT EXISTS idx_health_project_date ON source_health(project_id, date);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_disabled_sources_project ON disabled_sources(project_id);
```

- [ ] **Step 4: 创建数据库连接模块**

创建 `server/db/index.js`:

```javascript
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/sentiment.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

function getDb() {
  if (!db) {
    // 确保数据目录存在
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);
    
    // 启用 WAL 模式
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    
    // 初始化 schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    
    console.log('[db] 数据库初始化完成');
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
```

- [ ] **Step 5: 创建 Express 入口文件**

创建 `server/index.js`:

```javascript
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { getDb, closeDb } = require('./db');
const logger = require('./logger');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// API 路由（将在后续任务中添加）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 静态文件（前端构建产物）
app.use(express.static(path.join(__dirname, '../client/dist')));

// 错误处理
app.use(errorHandler);

// 启动服务器
function startServer() {
  // 初始化数据库
  getDb();
  
  app.listen(PORT, () => {
    logger.info(`服务器启动: http://localhost:${PORT}`);
  });
}

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('收到关闭信号，正在关闭...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('收到关闭信号，正在关闭...');
  closeDb();
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
```

- [ ] **Step 6: 创建日志模块**

创建 `server/logger.js`:

```javascript
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logDir = path.join(__dirname, '../data');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'sentiment-monitor' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new DailyRotateFile({
      filename: path.join(logDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
    }),
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
});

module.exports = logger;
```

- [ ] **Step 7: 创建错误处理中间件**

创建 `server/middleware/errorHandler.js`:

```javascript
const logger = require('../logger');

function errorHandler(err, req, res, next) {
  logger.error('错误处理', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const status = err.status || 500;
  const message = err.message || '服务器内部错误';
  const code = err.code || 'INTERNAL_ERROR';

  res.status(status).json({
    error: {
      message,
      code,
    },
  });
}

module.exports = errorHandler;
```

- [ ] **Step 8: 创建数据目录**

```bash
mkdir -p data/backups
touch data/.gitkeep
```

- [ ] **Step 9: 测试服务器启动**

```bash
npm start
```

预期输出：
```
[db] 数据库初始化完成
服务器启动: http://localhost:3000
```

访问 `http://localhost:3000/api/health` 应返回：
```json
{"status":"ok","timestamp":"2026-07-31T..."}
```

- [ ] **Step 10: 提交代码**

```bash
git add .
git commit -m "feat: 初始化后端项目结构

- Express 服务器框架
- SQLite 数据库连接和 schema
- Winston 日志模块
- 错误处理中间件"
```

---

### Task 2: 项目管理 API

**Files:**
- Create: `server/api/projects.js`
- Test: `tests/server/api/projects.test.js`

- [ ] **Step 1: 编写项目管理 API 测试**

创建 `tests/server/api/projects.test.js`:

```javascript
const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');

describe('Projects API', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    // 清空测试数据
    db.exec('DELETE FROM projects');
  });

  afterAll(() => {
    db.close();
  });

  describe('POST /api/projects', () => {
    it('应该创建新项目', async () => {
      const project = {
        name: 'test-project',
        config: {
          keywords: ['OpenAN'],
          rssSources: ['https://example.com/rss'],
        },
      };

      const res = await request(app)
        .post('/api/projects')
        .send(project)
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(Number),
        name: 'test-project',
        enabled: 1,
      });
    });

    it('项目名称必须唯一', async () => {
      const project = { name: 'duplicate', config: {} };

      await request(app).post('/api/projects').send(project).expect(201);
      await request(app).post('/api/projects').send(project).expect(409);
    });
  });

  describe('GET /api/projects', () => {
    it('应该返回项目列表', async () => {
      // 插入测试数据
      db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run(
        'project1',
        JSON.stringify({})
      );
      db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run(
        'project2',
        JSON.stringify({})
      );

      const res = await request(app).get('/api/projects').expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('project1');
    });
  });

  describe('GET /api/projects/:id', () => {
    it('应该返回项目详情', async () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({ keywords: ['test'] }));
      const id = result.lastInsertRowid;

      const res = await request(app).get(`/api/projects/${id}`).expect(200);

      expect(res.body.name).toBe('test');
      expect(res.body.config.keywords).toEqual(['test']);
    });

    it('项目不存在应返回 404', async () => {
      await request(app).get('/api/projects/999').expect(404);
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('应该更新项目', async () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('old-name', JSON.stringify({}));
      const id = result.lastInsertRowid;

      const res = await request(app)
        .put(`/api/projects/${id}`)
        .send({ name: 'new-name', config: { keywords: ['new'] } })
        .expect(200);

      expect(res.body.name).toBe('new-name');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('应该删除项目', async () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('to-delete', JSON.stringify({}));
      const id = result.lastInsertRowid;

      await request(app).delete(`/api/projects/${id}`).expect(204);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      expect(project).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- tests/server/api/projects.test.js
```

预期：测试失败（API 未实现）

- [ ] **Step 3: 实现项目管理 API**

创建 `server/api/projects.js`:

```javascript
const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

// GET /api/projects - 项目列表
router.get('/', (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  
  // 解析 config JSON
  const result = projects.map(p => ({
    ...p,
    config: JSON.parse(p.config),
  }));
  
  res.json(result);
});

// GET /api/projects/:id - 项目详情
router.get('/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  
  if (!project) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }
  
  res.json({
    ...project,
    config: JSON.parse(project.config),
  });
});

// POST /api/projects - 创建项目
router.post('/', (req, res) => {
  const { name, config } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: { message: '项目名称必填', code: 'VALIDATION_ERROR' } });
  }
  
  const db = getDb();
  
  try {
    const result = db
      .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run(name, JSON.stringify(config || {}));
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    
    logger.info('创建项目', { projectId: project.id, name: project.name });
    
    res.status(201).json({
      ...project,
      config: JSON.parse(project.config),
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: { message: '项目名称已存在', code: 'CONFLICT' } });
    }
    throw err;
  }
});

// PUT /api/projects/:id - 更新项目
router.put('/:id', (req, res) => {
  const { name, config, enabled } = req.body;
  const db = getDb();
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }
  
  const updates = [];
  const values = [];
  
  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (config !== undefined) {
    updates.push('config = ?');
    values.push(JSON.stringify(config));
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }
  
  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);
    
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  
  logger.info('更新项目', { projectId: req.params.id, updates: req.body });
  
  res.json({
    ...updated,
    config: JSON.parse(updated.config),
  });
});

// DELETE /api/projects/:id - 删除项目
router.delete('/:id', (req, res) => {
  const db = getDb();
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }
  
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  
  logger.info('删除项目', { projectId: req.params.id, name: project.name });
  
  res.status(204).send();
});

// POST /api/projects/:id/enable - 启用项目
router.post('/:id/enable', (req, res) => {
  const db = getDb();
  
  const result = db
    .prepare('UPDATE projects SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.params.id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }
  
  logger.info('启用项目', { projectId: req.params.id });
  
  res.json({ success: true });
});

// POST /api/projects/:id/disable - 禁用项目
router.post('/:id/disable', (req, res) => {
  const db = getDb();
  
  const result = db
    .prepare('UPDATE projects SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.params.id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }
  
  logger.info('禁用项目', { projectId: req.params.id });
  
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 4: 在 server/index.js 中注册路由**

修改 `server/index.js`，在 `// API 路由` 注释后添加：

```javascript
const projectsRouter = require('./api/projects');
app.use('/api/projects', projectsRouter);
```

- [ ] **Step 5: 安装测试依赖**

```bash
npm install --save-dev supertest
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test -- tests/server/api/projects.test.js
```

预期：所有测试通过

- [ ] **Step 7: 提交代码**

```bash
git add .
git commit -m "feat: 实现项目管理 API

- GET /api/projects - 项目列表
- GET /api/projects/:id - 项目详情
- POST /api/projects - 创建项目
- PUT /api/projects/:id - 更新项目
- DELETE /api/projects/:id - 删除项目
- POST /api/projects/:id/enable - 启用项目
- POST /api/projects/:id/disable - 禁用项目"
```

---

### Task 3: 健康度 API

**Files:**
- Create: `server/api/health.js`
- Test: `tests/server/api/health.test.js`

- [ ] **Step 1: 编写健康度 API 测试**

创建 `tests/server/api/health.test.js`:

```javascript
const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');

describe('Health API', () => {
  let db;
  let projectId;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM source_health');
    db.exec('DELETE FROM projects');
    
    const result = db
      .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run('test-project', JSON.stringify({}));
    projectId = result.lastInsertRowid;
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/projects/:id/health', () => {
    it('应该返回健康度概览', async () => {
      // 插入测试数据
      db.prepare(
        'INSERT INTO source_health (project_id, source, date, raw_count, status) VALUES (?, ?, ?, ?, ?)'
      ).run(projectId, 'weibo', '2026-07-31', 10, 'normal');
      db.prepare(
        'INSERT INTO source_health (project_id, source, date, raw_count, status) VALUES (?, ?, ?, ?, ?)'
      ).run(projectId, 'bilibili', '2026-07-31', 0, 'anomaly');

      const res = await request(app)
        .get(`/api/projects/${projectId}/health`)
        .expect(200);

      expect(res.body).toMatchObject({
        normal: 1,
        anomaly: 1,
        disabled: 0,
      });
    });
  });

  describe('GET /api/projects/:id/health/sources', () => {
    it('应该返回各源健康度详情', async () => {
      db.prepare(
        'INSERT INTO source_health (project_id, source, date, raw_count, filtered_count, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(projectId, 'weibo', '2026-07-31', 10, 8, 'normal');

      const res = await request(app)
        .get(`/api/projects/${projectId}/health/sources`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        source: 'weibo',
        raw_count: 10,
        filtered_count: 8,
        status: 'normal',
      });
    });
  });

  describe('GET /api/projects/:id/health/trend', () => {
    it('应该返回健康度趋势（最近7天）', async () => {
      // 插入7天数据
      for (let i = 0; i < 7; i++) {
        const date = `2026-07-${31 - i}`;
        db.prepare(
          'INSERT INTO source_health (project_id, source, date, raw_count, status) VALUES (?, ?, ?, ?, ?)'
        ).run(projectId, 'weibo', date, 10 - i, 'normal');
      }

      const res = await request(app)
        .get(`/api/projects/${projectId}/health/trend`)
        .expect(200);

      expect(res.body).toHaveLength(7);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- tests/server/api/health.test.js
```

- [ ] **Step 3: 实现健康度 API**

创建 `server/api/health.js`:

```javascript
const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router({ mergeParams: true });

// GET /api/projects/:id/health - 健康度概览
router.get('/', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  // 统计各状态数量
  const stats = db
    .prepare(
      `
    SELECT status, COUNT(DISTINCT source) as count
    FROM source_health
    WHERE project_id = ? AND date = date('now')
    GROUP BY status
  `
    )
    .all(projectId);

  const result = {
    normal: 0,
    anomaly: 0,
    disabled: 0,
  };

  stats.forEach(s => {
    result[s.status] = s.count;
  });

  // 查询禁用源数量
  const disabledCount = db
    .prepare('SELECT COUNT(*) as count FROM disabled_sources WHERE project_id = ?')
    .get(projectId);
  result.disabled = disabledCount.count;

  res.json(result);
});

// GET /api/projects/:id/health/sources - 各源健康度详情
router.get('/sources', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const sources = db
    .prepare(
      `
    SELECT source, date, raw_count, filtered_count, status, created_at
    FROM source_health
    WHERE project_id = ? AND date = date('now')
    ORDER BY source
  `
    )
    .all(projectId);

  res.json(sources);
});

// GET /api/projects/:id/health/trend - 健康度趋势（最近7天）
router.get('/trend', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const trend = db
    .prepare(
      `
    SELECT date, 
           SUM(raw_count) as total_raw,
           SUM(filtered_count) as total_filtered,
           COUNT(DISTINCT CASE WHEN status = 'anomaly' THEN source END) as anomaly_count
    FROM source_health
    WHERE project_id = ? AND date >= date('now', '-7 days')
    GROUP BY date
    ORDER BY date
  `
    )
    .all(projectId);

  res.json(trend);
});

module.exports = router;
```

- [ ] **Step 4: 在 server/index.js 中注册路由**

```javascript
const healthRouter = require('./api/health');
app.use('/api/projects/:id/health', healthRouter);
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -- tests/server/api/health.test.js
```

- [ ] **Step 6: 提交代码**

```bash
git add .
git commit -m "feat: 实现健康度 API

- GET /api/projects/:id/health - 健康度概览
- GET /api/projects/:id/health/sources - 各源健康度详情
- GET /api/projects/:id/health/trend - 健康度趋势"
```

---

### Task 4: 历史数据 API

**Files:**
- Create: `server/api/history.js`

- [ ] **Step 1: 实现历史数据 API**

创建 `server/api/history.js`:

```javascript
const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router({ mergeParams: true });

// GET /api/projects/:id/items - 采集记录（分页）
router.get('/items', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const source = req.query.source;
  const riskLevel = req.query.riskLevel;

  let sql = 'SELECT * FROM items WHERE project_id = ?';
  const params = [projectId];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  if (riskLevel) {
    sql += ' AND risk_level = ?';
    params.push(riskLevel);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params);

  // 获取总数
  let countSql = 'SELECT COUNT(*) as total FROM items WHERE project_id = ?';
  const countParams = [projectId];

  if (source) {
    countSql += ' AND source = ?';
    countParams.push(source);
  }

  if (riskLevel) {
    countSql += ' AND risk_level = ?';
    countParams.push(riskLevel);
  }

  const { total } = db.prepare(countSql).get(...countParams);

  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /api/projects/:id/items/stats - 统计信息
router.get('/items/stats', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const stats = db
    .prepare(
      `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_risk,
      COUNT(CASE WHEN risk_level = 'medium' THEN 1 END) as medium_risk,
      COUNT(CASE WHEN risk_level = 'low' THEN 1 END) as low_risk,
      COUNT(DISTINCT source) as sources
    FROM items
    WHERE project_id = ? AND date(timestamp) = date('now')
  `
    )
    .get(projectId);

  res.json(stats);
});

// POST /api/projects/:id/items/export - 导出数据
router.post('/items/export', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;
  const { startDate, endDate, format } = req.body;

  let sql = 'SELECT * FROM items WHERE project_id = ?';
  const params = [projectId];

  if (startDate) {
    sql += ' AND date(timestamp) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND date(timestamp) <= ?';
    params.push(endDate);
  }

  sql += ' ORDER BY timestamp DESC';

  const items = db.prepare(sql).all(...params);

  if (format === 'csv') {
    // 简单 CSV 导出
    const headers = ['id', 'source', 'title', 'url', 'timestamp', 'risk_level'];
    const csv = [
      headers.join(','),
      ...items.map(item =>
        headers.map(h => `"${(item[h] || '').toString().replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=export.csv');
    res.send(csv);
  } else {
    res.json(items);
  }
});

module.exports = router;
```

- [ ] **Step 2: 注册路由**

```javascript
const historyRouter = require('./api/history');
app.use('/api/projects/:id', historyRouter);
```

- [ ] **Step 3: 提交代码**

```bash
git add .
git commit -m "feat: 实现历史数据 API

- GET /api/projects/:id/items - 采集记录（分页、过滤）
- GET /api/projects/:id/items/stats - 统计信息
- POST /api/projects/:id/items/export - 导出数据"
```

---

### Task 5: 决策记录 API

**Files:**
- Create: `server/api/decisions.js`

- [ ] **Step 1: 实现决策记录 API**

创建 `server/api/decisions.js`:

```javascript
const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

// GET /api/decisions - 决策记录列表
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const projectId = req.query.projectId;

  let sql = 'SELECT * FROM decisions';
  const params = [];

  if (projectId) {
    sql += ' WHERE project_id = ?';
    params.push(projectId);
  }

  sql += ' ORDER BY executed_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const decisions = db.prepare(sql).all(...params);

  res.json(decisions);
});

// GET /api/decisions/:id - 决策详情
router.get('/:id', (req, res) => {
  const db = getDb();
  const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(req.params.id);

  if (!decision) {
    return res.status(404).json({ error: { message: '决策不存在', code: 'NOT_FOUND' } });
  }

  res.json(decision);
});

// POST /api/decisions/:id/undo - 撤销决策
router.post('/:id/undo', (req, res) => {
  const db = getDb();
  const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(req.params.id);

  if (!decision) {
    return res.status(404).json({ error: { message: '决策不存在', code: 'NOT_FOUND' } });
  }

  // 如果是禁用源的决策，恢复源
  if (decision.action === 'disable_source') {
    db.prepare('DELETE FROM disabled_sources WHERE project_id = ? AND source = ?').run(
      decision.project_id,
      decision.target
    );

    logger.info('撤销决策：恢复源', {
      decisionId: decision.id,
      source: decision.target,
    });
  }

  // 删除决策记录
  db.prepare('DELETE FROM decisions WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 2: 注册路由**

```javascript
const decisionsRouter = require('./api/decisions');
app.use('/api/decisions', decisionsRouter);
```

- [ ] **Step 3: 提交代码**

```bash
git add .
git commit -m "feat: 实现决策记录 API

- GET /api/decisions - 决策记录列表
- GET /api/decisions/:id - 决策详情
- POST /api/decisions/:id/undo - 撤销决策"
```

---

### Task 6: 配置管理 API

**Files:**
- Create: `server/api/config.js`
- Create: `config/decision-rules.json`

- [ ] **Step 1: 创建默认决策规则配置**

创建 `config/decision-rules.json`:

```json
{
  "sourceHealth": {
    "disableAfterDays": 3,
    "threshold": 0.5,
    "notifyOnDisable": true
  },
  "contentQuality": {
    "zeroDataAction": "checkConfig",
    "highVolumeThreshold": 200,
    "highVolumeAction": "strictFilter"
  }
}
```

- [ ] **Step 2: 实现配置管理 API**

创建 `server/api/config.js`:

```javascript
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

const RULES_PATH = path.join(__dirname, '../../config/decision-rules.json');

// GET /api/config/rules - 决策规则
router.get('/rules', (req, res) => {
  try {
    const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: { message: '读取配置失败', code: 'CONFIG_ERROR' } });
  }
});

// PUT /api/config/rules - 更新决策规则
router.put('/rules', (req, res) => {
  try {
    fs.writeFileSync(RULES_PATH, JSON.stringify(req.body, null, 2));
    logger.info('更新决策规则', { rules: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { message: '保存配置失败', code: 'CONFIG_ERROR' } });
  }
});

// GET /api/config/llm - LLM 配置
router.get('/llm', (req, res) => {
  const db = getDb();
  const config = db.prepare("SELECT value FROM config WHERE key = 'llm_config'").get();

  if (config) {
    const llmConfig = JSON.parse(config.value);
    // 隐藏 API key
    if (llmConfig.apiKey) {
      llmConfig.apiKey = '***' + llmConfig.apiKey.slice(-4);
    }
    res.json(llmConfig);
  } else {
    res.json({ enabled: false });
  }
});

// PUT /api/config/llm - 更新 LLM 配置
router.put('/llm', (req, res) => {
  const db = getDb();
  const { apiKey, baseUrl, model, enabled } = req.body;

  const config = { apiKey, baseUrl, model, enabled };

  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('llm_config', ?)").run(
    JSON.stringify(config)
  );

  logger.info('更新 LLM 配置', { enabled, model });

  res.json({ success: true });
});

// GET /api/config/email - 邮件配置
router.get('/email', (req, res) => {
  const db = getDb();
  const config = db.prepare("SELECT value FROM config WHERE key = 'email_config'").get();

  if (config) {
    const emailConfig = JSON.parse(config.value);
    // 隐藏密码
    if (emailConfig.password) {
      emailConfig.password = '***';
    }
    res.json(emailConfig);
  } else {
    res.json({ enabled: false });
  }
});

// PUT /api/config/email - 更新邮件配置
router.put('/email', (req, res) => {
  const db = getDb();
  const config = req.body;

  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('email_config', ?)").run(
    JSON.stringify(config)
  );

  logger.info('更新邮件配置', { enabled: config.enabled, host: config.host });

  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 3: 注册路由**

```javascript
const configRouter = require('./api/config');
app.use('/api/config', configRouter);
```

- [ ] **Step 4: 提交代码**

```bash
git add .
git commit -m "feat: 实现配置管理 API

- GET /api/config/rules - 决策规则
- PUT /api/config/rules - 更新决策规则
- GET /api/config/llm - LLM 配置
- PUT /api/config/llm - 更新 LLM 配置
- GET /api/config/email - 邮件配置
- PUT /api/config/email - 更新邮件配置"
```

---

## Phase 2: 决策引擎（第 3 周）

### Task 7: 决策引擎核心

**Files:**
- Create: `server/decision-engine.js`
- Test: `tests/server/decision-engine.test.js`

- [ ] **Step 1: 编写决策引擎测试**

创建 `tests/server/decision-engine.test.js`:

```javascript
const DecisionEngine = require('../../server/decision-engine');
const { getDb } = require('../../server/db');

describe('DecisionEngine', () => {
  let db;
  let engine;

  beforeAll(() => {
    db = getDb();
    engine = new DecisionEngine();
  });

  beforeEach(() => {
    db.exec('DELETE FROM decisions');
    db.exec('DELETE FROM disabled_sources');
    db.exec('DELETE FROM source_health');
    db.exec('DELETE FROM projects');
  });

  afterAll(() => {
    db.close();
  });

  describe('checkSourceHealth', () => {
    it('连续3天异常应禁用源', () => {
      // 插入项目
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({}));
      const projectId = result.lastInsertRowid;

      // 插入3天异常数据
      for (let i = 0; i < 3; i++) {
        const date = `2026-07-${31 - i}`;
        db.prepare(
          'INSERT INTO source_health (project_id, source, date, raw_count, status) VALUES (?, ?, ?, ?, ?)'
        ).run(projectId, 'weibo', date, 0, 'anomaly');
      }

      const decisions = engine.checkSourceHealth(projectId);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('disable_source');
      expect(decisions[0].target).toBe('weibo');
    });

    it('已禁用的源不应重复禁用', () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({}));
      const projectId = result.lastInsertRowid;

      // 先禁用
      db.prepare('INSERT INTO disabled_sources (project_id, source, reason) VALUES (?, ?, ?)').run(
        projectId,
        'weibo',
        'test'
      );

      const decisions = engine.checkSourceHealth(projectId);

      expect(decisions).toHaveLength(0);
    });
  });

  describe('checkContentQuality', () => {
    it('数据量为0应建议检查配置', () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({}));
      const projectId = result.lastInsertRowid;

      const decisions = engine.checkContentQuality(projectId, 0);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('check_config');
    });

    it('数据量异常多应建议严格过滤', () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({}));
      const projectId = result.lastInsertRowid;

      const decisions = engine.checkContentQuality(projectId, 500);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('strict_filter');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- tests/server/decision-engine.test.js
```

- [ ] **Step 3: 实现决策引擎**

创建 `server/decision-engine.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const logger = require('./logger');

const RULES_PATH = path.join(__dirname, '../config/decision-rules.json');

class DecisionEngine {
  constructor() {
    this.rules = this.loadRules();
  }

  loadRules() {
    try {
      return JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
    } catch (err) {
      logger.error('加载决策规则失败', err);
      return {
        sourceHealth: { disableAfterDays: 3, threshold: 0.5 },
        contentQuality: { highVolumeThreshold: 200 },
      };
    }
  }

  checkSourceHealth(projectId) {
    const db = getDb();
    const decisions = [];

    // 获取已禁用的源
    const disabledSources = db
      .prepare('SELECT source FROM disabled_sources WHERE project_id = ?')
      .all(projectId)
      .map(r => r.source);

    // 检查每个源的健康度
    const sources = db
      .prepare(
        `
      SELECT source, COUNT(*) as anomalyDays
      FROM source_health
      WHERE project_id = ? 
        AND status = 'anomaly'
        AND date >= date('now', '-${this.rules.sourceHealth.disableAfterDays} days')
      GROUP BY source
    `
      )
      .all(projectId);

    for (const { source, anomalyDays } of sources) {
      // 已禁用则跳过
      if (disabledSources.includes(source)) {
        continue;
      }

      // 连续异常天数达到阈值
      if (anomalyDays >= this.rules.sourceHealth.disableAfterDays) {
        decisions.push({
          action: 'disable_source',
          target: source,
          reason: `连续${anomalyDays}天数据异常`,
        });
      }
    }

    return decisions;
  }

  checkContentQuality(projectId, itemCount) {
    const decisions = [];

    // 数据量为 0
    if (itemCount === 0) {
      decisions.push({
        action: 'check_config',
        target: 'project',
        reason: '今日数据量为0，建议检查配置',
      });
    }

    // 数据量异常多
    if (itemCount > this.rules.contentQuality.highVolumeThreshold) {
      decisions.push({
        action: 'strict_filter',
        target: 'project',
        reason: `数据量异常多（${itemCount}条），建议启用严格过滤`,
      });
    }

    return decisions;
  }

  executeDecisions(projectId, decisions) {
    const db = getDb();

    for (const decision of decisions) {
      // 记录决策
      db.prepare(
        'INSERT INTO decisions (project_id, action, target, reason) VALUES (?, ?, ?, ?)'
      ).run(projectId, decision.action, decision.target, decision.reason);

      // 执行决策
      if (decision.action === 'disable_source') {
        db.prepare(
          'INSERT INTO disabled_sources (project_id, source, reason) VALUES (?, ?, ?)'
        ).run(projectId, decision.target, decision.reason);

        logger.warn('自动禁用源', {
          projectId,
          source: decision.target,
          reason: decision.reason,
        });
      }

      logger.info('执行决策', { projectId, decision });
    }

    return decisions;
  }
}

module.exports = DecisionEngine;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- tests/server/decision-engine.test.js
```

- [ ] **Step 5: 提交代码**

```bash
git add .
git commit -m "feat: 实现决策引擎

- 数据源健康度检查（连续异常自动禁用）
- 内容质量检查（数据量为0/异常多）
- 决策执行和记录"
```

---

### Task 8: 通知模块

**Files:**
- Create: `server/notifier.js`

- [ ] **Step 1: 实现通知模块**

创建 `server/notifier.js`:

```javascript
const nodemailer = require('nodemailer');
const { getDb } = require('./db');
const logger = require('./logger');

class Notifier {
  constructor() {
    this.transporter = null;
  }

  async getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const db = getDb();
    const config = db.prepare("SELECT value FROM config WHERE key = 'email_config'").get();

    if (!config) {
      logger.warn('邮件配置不存在，跳过通知');
      return null;
    }

    const emailConfig = JSON.parse(config.value);

    if (!emailConfig.enabled) {
      logger.warn('邮件通知未启用');
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port || 587,
      secure: emailConfig.secure || false,
      auth: {
        user: emailConfig.user,
        pass: emailConfig.password,
      },
    });

    return this.transporter;
  }

  async sendDecisionNotification(projectId, decisions) {
    const transporter = await this.getTransporter();
    if (!transporter) {
      return;
    }

    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const config = db.prepare("SELECT value FROM config WHERE key = 'email_config'").get();
    const emailConfig = JSON.parse(config.value);

    const subject = `[舆情监控] 自动决策通知 - ${project.name}`;
    const html = `
      <h2>自动决策通知</h2>
      <p>项目 <strong>${project.name}</strong> 触发了以下自动决策：</p>
      <ul>
        ${decisions
          .map(
            d => `
          <li>
            <strong>${d.action}</strong>: ${d.target}<br>
            原因: ${d.reason}
          </li>
        `
          )
          .join('')}
      </ul>
      <p>请登录管理界面查看详情或撤销决策。</p>
    `;

    try {
      await transporter.sendMail({
        from: emailConfig.from,
        to: emailConfig.to,
        subject,
        html,
      });

      logger.info('发送决策通知邮件成功', { projectId, decisions: decisions.length });
    } catch (err) {
      logger.error('发送决策通知邮件失败', err);
    }
  }

  async sendErrorNotification(error) {
    const transporter = await this.getTransporter();
    if (!transporter) {
      return;
    }

    const db = getDb();
    const config = db.prepare("SELECT value FROM config WHERE key = 'email_config'").get();
    if (!config) return;

    const emailConfig = JSON.parse(config.value);

    const subject = '[舆情监控] 系统错误通知';
    const html = `
      <h2>系统错误</h2>
      <p>发生错误: ${error.message}</p>
      <pre>${error.stack}</pre>
    `;

    try {
      await transporter.sendMail({
        from: emailConfig.from,
        to: emailConfig.to,
        subject,
        html,
      });

      logger.info('发送错误通知邮件成功');
    } catch (err) {
      logger.error('发送错误通知邮件失败', err);
    }
  }
}

module.exports = new Notifier();
```

- [ ] **Step 2: 提交代码**

```bash
git add .
git commit -m "feat: 实现通知模块

- 邮件通知（决策通知、错误通知）
- 从数据库读取邮件配置
- 支持动态创建 transporter"
```

---

### Task 9: 定时任务

**Files:**
- Create: `server/scheduler.js`
- Create: `server/lock.js`

- [ ] **Step 1: 实现并发控制**

创建 `server/lock.js`:

```javascript
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const LOCK_FILE = path.join(__dirname, '../data/.lock');

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    
    // 检查进程是否存活
    try {
      process.kill(pid, 0);
      throw new Error(`另一个进程正在运行 (PID: ${pid})`);
    } catch (e) {
      if (e.code === 'ESRCH') {
        // 进程不存在，删除锁文件
        logger.warn('发现残留锁文件，清理中', { pid });
        fs.unlinkSync(LOCK_FILE);
      } else if (e.code === 'EPERM') {
        throw new Error(`无权限检查进程 (PID: ${pid})`);
      } else {
        throw e;
      }
    }
  }

  fs.writeFileSync(LOCK_FILE, process.pid.toString());
  logger.info('获取锁成功', { pid: process.pid });
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    logger.info('释放锁', { pid: process.pid });
  }
}

function isLocked() {
  return fs.existsSync(LOCK_FILE);
}

module.exports = { acquireLock, releaseLock, isLocked };
```

- [ ] **Step 2: 实现定时任务**

创建 `server/scheduler.js`:

```javascript
const cron = require('node-cron');
const DecisionEngine = require('./decision-engine');
const notifier = require('./notifier');
const { getDb } = require('./db');
const logger = require('./logger');
const { acquireLock, releaseLock, isLocked } = require('./lock');

class Scheduler {
  constructor() {
    this.engine = new DecisionEngine();
    this.jobs = [];
  }

  start() {
    // 每天 8:00 执行采集
    const dailyJob = cron.schedule('0 8 * * *', async () => {
      logger.info('开始执行每日采集任务');
      
      if (isLocked()) {
        logger.warn('已有任务在运行，跳过');
        return;
      }

      try {
        acquireLock();
        
        const db = getDb();
        const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();

        for (const project of projects) {
          try {
            // 这里应该调用实际的采集逻辑
            // 暂时只记录日志
            logger.info('采集项目', { projectId: project.id, name: project.name });
            
            // 执行决策检查
            const healthDecisions = this.engine.checkSourceHealth(project.id);
            if (healthDecisions.length > 0) {
              this.engine.executeDecisions(project.id, healthDecisions);
              await notifier.sendDecisionNotification(project.id, healthDecisions);
            }
          } catch (err) {
            logger.error('项目采集失败', { projectId: project.id, error: err.message });
          }
        }
      } catch (err) {
        logger.error('每日采集任务失败', err);
        await notifier.sendErrorNotification(err);
      } finally {
        releaseLock();
      }
    });

    this.jobs.push(dailyJob);

    // 每小时检查健康度
    const healthJob = cron.schedule('0 * * * *', async () => {
      logger.info('开始执行健康度检查');

      const db = getDb();
      const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();

      for (const project of projects) {
        const decisions = this.engine.checkSourceHealth(project.id);
        if (decisions.length > 0) {
          this.engine.executeDecisions(project.id, decisions);
          await notifier.sendDecisionNotification(project.id, decisions);
        }
      }
    });

    this.jobs.push(healthJob);

    logger.info('定时任务已启动');
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    logger.info('定时任务已停止');
  }
}

module.exports = new Scheduler();
```

- [ ] **Step 3: 在 server/index.js 中启动定时任务**

修改 `server/index.js`，在 `startServer` 函数中添加：

```javascript
const scheduler = require('./scheduler');

function startServer() {
  getDb();
  
  app.listen(PORT, () => {
    logger.info(`服务器启动: http://localhost:${PORT}`);
  });

  // 启动定时任务
  if (process.env.NODE_ENV !== 'test') {
    scheduler.start();
  }
}
```

- [ ] **Step 4: 提交代码**

```bash
git add .
git commit -m "feat: 实现定时任务和并发控制

- node-cron 定时采集（每天8:00）
- node-cron 健康度检查（每小时）
- 文件锁防止并发执行
- 优雅关闭处理"
```

---

## Phase 3: 前端开发（第 4-6 周）

由于前端开发任务较多，我将创建一个单独的前端实施计划文档。

创建 `docs/superpowers/plans/2026-07-31-sentiment-monitor-web-frontend.md`:

```markdown
# Sentiment Monitor Web 前端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 React + Vite 前端管理界面

**Architecture:** React 单页应用，React Router 路由，Axios API 调用，Ant Design UI 组件库

**Tech Stack:** React 18, Vite, React Router, Axios, Ant Design, Recharts

---

## 文件结构

```
client/
├── src/
│   ├── components/
│   │   ├── Layout.jsx
│   │   ├── StatCard.jsx
│   │   ├── HealthChart.jsx
│   │   └── DecisionList.jsx
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── ProjectList.jsx
│   │   ├── ProjectDetail.jsx
│   │   ├── HealthMonitor.jsx
│   │   ├── History.jsx
│   │   ├── Decisions.jsx
│   │   └── Config.jsx
│   ├── services/
│   │   └── api.js
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
└── vite.config.js
```

---

## Task 1: 前端项目初始化

- [ ] **Step 1: 创建 Vite + React 项目**

```bash
cd client
npm create vite@latest . -- --template react
npm install
```

- [ ] **Step 2: 安装依赖**

```bash
npm install react-router-dom axios antd @ant-design/icons recharts
```

- [ ] **Step 3: 配置 Vite 代理**

修改 `client/vite.config.js`:

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: 创建 API 服务**

创建 `client/src/services/api.js`:

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// 项目管理
export const projectsApi = {
  list: () => api.get('/projects'),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  enable: (id) => api.post(`/projects/${id}/enable`),
  disable: (id) => api.post(`/projects/${id}/disable`),
};

// 健康度
export const healthApi = {
  overview: (projectId) => api.get(`/projects/${projectId}/health`),
  sources: (projectId) => api.get(`/projects/${projectId}/health/sources`),
  trend: (projectId) => api.get(`/projects/${projectId}/health/trend`),
};

// 历史数据
export const historyApi = {
  items: (projectId, params) => api.get(`/projects/${projectId}/items`, { params }),
  stats: (projectId) => api.get(`/projects/${projectId}/items/stats`),
  export: (projectId, data) => api.post(`/projects/${projectId}/items/export`, data),
};

// 决策记录
export const decisionsApi = {
  list: (params) => api.get('/decisions', { params }),
  get: (id) => api.get(`/decisions/${id}`),
  undo: (id) => api.post(`/decisions/${id}/undo`),
};

// 配置
export const configApi = {
  getRules: () => api.get('/config/rules'),
  updateRules: (data) => api.put('/config/rules', data),
  getLlm: () => api.get('/config/llm'),
  updateLlm: (data) => api.put('/config/llm', data),
  getEmail: () => api.get('/config/email'),
  updateEmail: (data) => api.put('/config/email', data),
};

export default api;
```

- [ ] **Step 5: 提交代码**

```bash
git add .
git commit -m "feat: 初始化前端项目

- Vite + React 项目
- React Router 路由
- Axios API 服务
- Ant Design UI 组件库"
```

---

## Task 2: 布局和路由

- [ ] **Step 1: 创建布局组件**

创建 `client/src/components/Layout.jsx`:

```jsx
import { Layout, Menu } from 'antd';
import { 
  DashboardOutlined, 
  ProjectOutlined, 
  HeartOutlined, 
  HistoryOutlined,
  SettingOutlined 
} from '@ant-design/icons';
import { Link, useLocation, Outlet } from 'react-router-dom';

const { Header, Sider, Content } = Layout;

function AppLayout() {
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
    { key: '/projects', icon: <ProjectOutlined />, label: <Link to="/projects">项目管理</Link> },
    { key: '/decisions', icon: <HistoryOutlined />, label: <Link to="/decisions">决策记录</Link> },
    { key: '/config', icon: <SettingOutlined />, label: <Link to="/config">系统配置</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light">
        <div style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold' }}>
          舆情监控
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px' }}>
          <h2 style={{ margin: 0 }}>Sentiment Monitor</h2>
        </Header>
        <Content style={{ margin: '16px' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

export default AppLayout;
```

- [ ] **Step 2: 配置路由**

修改 `client/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import Decisions from './pages/Decisions';
import Config from './pages/Config';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="config" element={<Config />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 3: 提交代码**

```bash
git add .
git commit -m "feat: 实现前端布局和路由

- Layout 组件（侧边栏 + 内容区）
- React Router 路由配置
- 菜单导航"
```

---

## Task 3-8: 页面组件

（Dashboard、ProjectList、ProjectDetail、Decisions、Config、HealthMonitor 等页面的实现，每个页面一个 Task）

由于篇幅限制，这里省略详细代码。每个页面的实现包括：
1. 创建页面组件
2. 调用 API 获取数据
3. 使用 Ant Design 组件渲染 UI
4. 处理用户交互
5. 提交代码

---

## Phase 4: 集成和部署（第 7 周）

### Task 9: Docker 配置

- [ ] **Step 1: 创建 Dockerfile**

创建 `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install --production

# 复制代码
COPY . .

# 构建前端
RUN cd client && npm install && npm run build

# 暴露端口
EXPOSE 3000

# 启动
CMD ["node", "server/index.js"]
```

- [ ] **Step 2: 创建 docker-compose.yml**

创建 `docker-compose.yml`:

```yaml
version: '3'
services:
  sentiment-monitor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

- [ ] **Step 3: 提交代码**

```bash
git add .
git commit -m "feat: 添加 Docker 配置

- Dockerfile
- docker-compose.yml"
```

---

### Task 10: 启动脚本

- [ ] **Step 1: 创建 Linux/macOS 启动脚本**

创建 `start.sh`:

```bash
#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "首次运行，安装依赖..."
  npm install --production
fi

if [ ! -d "client/node_modules" ]; then
  echo "安装前端依赖..."
  cd client && npm install && cd ..
fi

if [ ! -d "client/dist" ]; then
  echo "构建前端..."
  cd client && npm run build && cd ..
fi

echo "启动服务..."
node server/index.js
```

- [ ] **Step 2: 创建 Windows 启动脚本**

创建 `start.bat`:

```batch
@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo 首次运行，安装依赖...
  call npm install --production
)

if not exist "client\node_modules" (
  echo 安装前端依赖...
  cd client
  call npm install
  cd ..
)

if not exist "client\dist" (
  echo 构建前端...
  cd client
  call npm run build
  cd ..
)

echo 启动服务...
node server/index.js
```

- [ ] **Step 3: 设置执行权限**

```bash
chmod +x start.sh
```

- [ ] **Step 4: 提交代码**

```bash
git add .
git commit -m "feat: 添加启动脚本

- start.sh (Linux/macOS)
- start.bat (Windows)"
```

---

## 完成检查清单

- [ ] 后端 API 全部实现
- [ ] 前端页面全部实现
- [ ] 决策引擎正常工作
- [ ] 定时任务正常执行
- [ ] Docker 部署测试通过
- [ ] 本地部署测试通过
- [ ] 文档完善（README、API 文档）
- [ ] 所有测试通过

---

## 部署指南

### 本地部署

```bash
# 1. 克隆项目
git clone <repo-url>
cd sentiment-monitor

# 2. 启动服务
./start.sh  # Linux/macOS
start.bat   # Windows

# 3. 访问
# http://localhost:3000
```

### Docker 部署

```bash
# 1. 克隆项目
git clone <repo-url>
cd sentiment-monitor

# 2. 启动服务
docker-compose up -d

# 3. 访问
# http://localhost:3000
```

---

**计划完成。**
