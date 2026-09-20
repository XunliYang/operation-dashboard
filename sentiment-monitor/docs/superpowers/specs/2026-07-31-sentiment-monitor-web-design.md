# Sentiment Monitor Web 服务设计文档

**日期**: 2026-07-31  
**状态**: 已确认  
**版本**: 1.0

## 1. 概述

将 sentiment-monitor 从 CLI 工具升级为独立 Web 服务，提供自主决策能力和 Web 管理界面。

### 1.1 核心目标

- **独立服务**：自主管理生命周期，内置定时任务
- **Web 管理界面**：配置管理、健康监控、历史数据查看
- **自主决策**：异常时自动处理，邮件通知管理员
- **双入口**：Web 界面 + CLI 命令

### 1.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React + Vite | 管理界面，单人使用，无认证 |
| 后端 | Express | REST API + 定时任务 |
| 数据库 | SQLite | 存储配置、历史数据、决策记录 |
| 通知 | 邮件 | 复用 nodemailer |
| 部署 | Node.js + Docker | 本地部署 + 容器化部署 |

## 2. 架构设计

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│  sentiment-monitor (独立 Web 服务)                       │
├─────────────────────────────────────────────────────────┤
│  前端 (React + Vite)                                    │
│  ├─ Dashboard（统计、健康度、决策）                       │
│  ├─ 项目管理（配置、启用/禁用）                          │
│  ├─ 健康监控（趋势图、异常详情）                         │
│  ├─ 历史数据（分页、过滤、导出）                         │
│  └─ 系统配置（决策规则、LLM、邮件）                      │
├─────────────────────────────────────────────────────────┤
│  后端 (Express)                                         │
│  ├─ REST API（项目、健康、历史、决策、配置）             │
│  ├─ 定时任务（node-cron：每天采集、每小时检查）          │
│  ├─ 决策引擎（规则驱动：数据源健康、内容质量）           │
│  ├─ 通知模块（邮件：决策通知）                          │
│  └─ 并发控制（SQLite WAL + 文件锁）                     │
├─────────────────────────────────────────────────────────┤
│  数据层                                                 │
│  ├─ SQLite（项目、采集记录、健康度、决策、配置）         │
│  ├─ 文件日志（data/app.log、data/health.log）           │
│  └─ 数据库备份（data/backups/）                         │
├─────────────────────────────────────────────────────────┤
│  外部依赖                                               │
│  ├─ LLM API（时间提取，可选）                           │
│  ├─ SMTP（邮件通知）                                    │
│  ├─ CLI 工具（xhs-cli、bili、mcporter）                 │
│  └─ DuckDuckGo（内置搜索）                              │
└─────────────────────────────────────────────────────────┘
```

### 2.2 项目结构

```
sentiment-monitor/
├── client/                    # 前端（React + Vite）
│   ├── src/
│   │   ├── components/        # UI 组件
│   │   ├── pages/             # 页面
│   │   └── App.jsx
│   └── dist/                  # 构建产物
├── server/                    # 后端
│   ├── api/                   # REST API
│   │   ├── projects.js        # 项目管理
│   │   ├── health.js          # 健康度查询
│   │   ├── history.js         # 历史数据
│   │   ├── decisions.js       # 决策记录
│   │   └── config.js          # 配置管理
│   ├── db/                    # SQLite 操作
│   │   ├── schema.sql         # 数据库 schema
│   │   └── index.js           # 数据库连接
│   ├── scheduler.js           # 定时任务
│   ├── decision-engine.js     # 决策引擎
│   ├── notifier.js            # 通知模块
│   └── index.js               # Express 入口
├── config/                    # 配置文件
│   └── decision-rules.json    # 决策规则
├── data/                      # 数据目录
│   ├── sentiment.db           # SQLite 数据库
│   ├── app.log                # 应用日志
│   ├── health.log             # 健康度日志
│   └── backups/               # 数据库备份
├── package.json
├── start.sh                   # Linux/macOS 启动脚本
├── start.bat                  # Windows 启动脚本
└── README.md
```

## 3. 数据库设计

### 3.1 Schema

```sql
-- 监控项目配置
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  config JSON NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 采集记录
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  url TEXT,
  snippet TEXT,
  timestamp DATETIME,
  risk_level TEXT,
  sentiment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 数据源健康度
CREATE TABLE source_health (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  raw_count INTEGER DEFAULT 0,
  filtered_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'normal',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 决策记录
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 禁用源状态
CREATE TABLE disabled_sources (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  disabled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 系统配置
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 3.2 索引

```sql
CREATE INDEX idx_items_project_date ON items(project_id, timestamp);
CREATE INDEX idx_items_source ON items(source);
CREATE INDEX idx_health_project_date ON source_health(project_id, date);
CREATE INDEX idx_decisions_project ON decisions(project_id);
```

## 4. API 设计

### 4.1 项目管理

```
GET    /api/projects              # 项目列表
GET    /api/projects/:id          # 项目详情
POST   /api/projects              # 创建项目
PUT    /api/projects/:id          # 更新项目
DELETE /api/projects/:id          # 删除项目
POST   /api/projects/:id/enable   # 启用项目
POST   /api/projects/:id/disable  # 禁用项目
```

### 4.2 健康监控

```
GET    /api/projects/:id/health          # 健康度概览
GET    /api/projects/:id/health/sources  # 各源健康度详情
GET    /api/projects/:id/health/trend    # 健康度趋势（最近7天）
```

### 4.3 历史数据

```
GET    /api/projects/:id/items           # 采集记录（分页）
GET    /api/projects/:id/items/stats     # 统计信息
POST   /api/projects/:id/items/export    # 导出数据
```

### 4.4 决策记录

```
GET    /api/decisions                    # 决策记录列表
GET    /api/decisions/:id                # 决策详情
POST   /api/decisions/:id/undo           # 撤销决策
```

### 4.5 系统配置

```
GET    /api/config/rules                 # 决策规则
PUT    /api/config/rules                 # 更新决策规则
GET    /api/config/llm                   # LLM 配置
PUT    /api/config/llm                   # 更新 LLM 配置
GET    /api/config/email                 # 邮件配置
PUT    /api/config/email                 # 更新邮件配置
```

### 4.6 操作接口

```
POST   /api/projects/:id/monitor         # 手动触发采集
POST   /api/projects/:id/search-sites    # 手动触发站点搜索
POST   /api/projects/:id/send-email      # 手动发送邮件
```

## 5. 决策引擎设计

### 5.1 规则配置

```json
// config/decision-rules.json
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

### 5.2 决策流程

```
采集完成
  → 健康度检查
  → 质量检查
  → 决策引擎
    ├─ 读取 config/decision-rules.json
    ├─ 读取 disabled_sources 表
    ├─ 分析异常
    └─ 生成决策
  → 执行决策
    ├─ 更新 disabled_sources 表
    ├─ 跳过被禁用的源
    └─ 发送邮件通知
```

### 5.3 决策类型

| 决策 | 触发条件 | 动作 |
|------|----------|------|
| 禁用源 | 连续 N 天数据量低于阈值 | 标记禁用，邮件通知 |
| 检查配置 | 数据量为 0 | 邮件通知，建议检查配置 |
| 严格过滤 | 数据量异常多 | 启用更严格的过滤规则 |

## 6. 前端页面设计

### 6.1 页面列表

| 页面 | 路径 | 功能 |
|------|------|------|
| Dashboard | `/` | 统计概览、健康度、最近决策 |
| 项目列表 | `/projects` | 项目列表、启用/禁用 |
| 项目详情 | `/projects/:id` | 项目配置、健康监控 |
| 健康监控 | `/projects/:id/health` | 各源健康度趋势 |
| 历史数据 | `/projects/:id/history` | 采集记录、过滤、导出 |
| 决策记录 | `/decisions` | 决策历史、撤销操作 |
| 系统配置 | `/config` | 决策规则、LLM、邮件配置 |

### 6.2 Dashboard 布局

```
┌─────────────────────────────────────────────────────────┐
│  今日统计                                                │
│  ├─ 采集总数: 123                                        │
│  ├─ 高风险: 5                                            │
│  └─ 活跃源: 15/18                                        │
├─────────────────────────────────────────────────────────┤
│  健康度概览                                              │
│  ├─ 正常: 15 个源                                        │
│  ├─ 异常: 3 个源（weibo, bilibili, v2ex）                │
│  └─ 禁用: 0 个源                                         │
├─────────────────────────────────────────────────────────┤
│  最近决策                                                │
│  ├─ 2026-07-31 08:00  禁用 weibo  连续3天无数据          │
│  └─ 2026-07-30 08:00  严格过滤  数据量异常多             │
├─────────────────────────────────────────────────────────┤
│  快速操作                                                │
│  ├─ [手动采集]  [发送报告]  [查看历史]                   │
└─────────────────────────────────────────────────────────┘
```

## 7. 部署方案

### 7.1 本地部署（Node.js）

**要求**：Node.js v18+

**步骤**：
```bash
# 1. 克隆或下载项目
git clone <repo-url>
cd sentiment-monitor

# 2. 安装依赖
npm install

# 3. 构建前端
npm run build:client

# 4. 启动服务
npm start
# 或
./start.sh  # Linux/macOS
start.bat   # Windows
```

**启动脚本**：
```bash
#!/bin/bash
# start.sh
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  echo "首次运行，安装依赖..."
  npm install --production
fi
node server/index.js
```

### 7.2 Docker 部署

**Dockerfile**：
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .
RUN npm run build:client

EXPOSE 3000

CMD ["node", "server/index.js"]
```

**docker-compose.yml**：
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

**启动**：
```bash
docker-compose up -d
```

### 7.3 Linux systemd 服务（可选）

```ini
# /etc/systemd/system/sentiment-monitor.service
[Unit]
Description=Sentiment Monitor Web Service
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/opt/sentiment-monitor
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**管理**：
```bash
sudo systemctl start sentiment-monitor
sudo systemctl enable sentiment-monitor
sudo systemctl status sentiment-monitor
```

## 8. 并发控制

### 8.1 SQLite WAL 模式

```javascript
// server/db/index.js
const db = new sqlite3('./data/sentiment.db');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
```

### 8.2 文件锁

```javascript
// server/lock.js
const fs = require('fs');
const LOCK_FILE = './data/.lock';

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf-8');
    // 检查进程是否存活
    try {
      process.kill(pid, 0);
      throw new Error('另一个进程正在运行');
    } catch (e) {
      // 进程不存在，删除锁文件
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, process.pid.toString());
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}
```

## 9. 日志管理

### 9.1 日志配置

```javascript
// server/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'data/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'data/app.log' 
    }),
  ],
});
```

### 9.2 日志轮转

使用 `winston-daily-rotate-file` 实现日志轮转：
- 每天生成新日志文件
- 保留最近 30 天
- 自动压缩旧日志

## 10. CLI 命令保留

保留原有 CLI 命令，用于调试和手动触发：

```bash
# 数据采集
node src/index.js monitor --profile openan

# 站点搜索
node src/index.js search-sites --profile openan

# 发送邮件
node src/index.js send-email --profile openan --production

# 查看报告
node src/index.js report --profile openan 2026-07-31
```

**并发控制**：CLI 执行前检查是否有 Web 定时任务在运行，避免冲突。

## 11. 数据迁移

**决策**：从零开始，不迁移旧 JSON 数据。

- 旧的 `data/*.json` 文件保留但不再使用
- SQLite 数据库首次启动时自动建表
- 提供示例数据导入脚本（可选）

## 12. 错误处理

### 12.1 API 错误处理

```javascript
// server/middleware/errorHandler.js
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message,
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});
```

### 12.2 定时任务错误处理

```javascript
// server/scheduler.js
cron.schedule('0 8 * * *', async () => {
  try {
    await runDailyMonitor();
  } catch (error) {
    logger.error('定时采集失败', error);
    await notifier.sendErrorNotification(error);
  }
});
```

## 13. 安全考虑

### 13.1 当前状态

- **无认证**：适合内网/localhost 使用
- **风险**：如果部署到公网，任何人都能访问

### 13.2 未来扩展

如需认证，可添加：
- Basic Auth（简单）
- JWT Token（API 级别）
- OAuth2（第三方登录）

## 14. 性能优化

### 14.1 数据库查询优化

- 使用索引（见 3.2 节）
- 分页查询（LIMIT/OFFSET）
- 批量插入（事务）

### 14.2 前端优化

- 代码分割（React.lazy）
- 图片懒加载
- API 请求缓存

## 15. 测试策略

### 15.1 单元测试

- 决策引擎逻辑
- 数据库操作
- API 接口

### 15.2 集成测试

- 完整采集流程
- 决策执行流程
- 邮件发送流程

### 15.3 端到端测试

- 前端页面交互
- API 调用链路

## 16. 里程碑

### Phase 1: 后端基础（1-2 周）

- [ ] 数据库 schema 和连接
- [ ] REST API 框架
- [ ] 项目管理 API
- [ ] 定时任务集成

### Phase 2: 决策引擎（1 周）

- [ ] 决策规则配置
- [ ] 健康度检查
- [ ] 质量检查
- [ ] 决策执行和通知

### Phase 3: 前端开发（2-3 周）

- [ ] Dashboard 页面
- [ ] 项目管理页面
- [ ] 健康监控页面
- [ ] 历史数据页面
- [ ] 系统配置页面

### Phase 4: 集成和部署（1 周）

- [ ] 前后端集成
- [ ] Docker 配置
- [ ] 文档完善
- [ ] 测试验证

**总计**：5-7 周

## 17. 风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| SQLite 并发限制 | 高并发时性能下降 | WAL 模式 + 文件锁 |
| 前端开发工作量大 | 延期 | 使用 UI 组件库（Ant Design） |
| 决策规则不完善 | 误判 | 可配置规则 + 撤销功能 |
| LLM API 成本 | 费用增加 | 仅在时间提取时使用，可关闭 |

## 18. 附录

### 18.1 相关文档

- [Agent Skill 定义](../../../.claude/skills/sentiment-monitor/SKILL.md)
- [集成设计](../../integration-design.md)

### 18.2 参考资料

- [Express.js 文档](https://expressjs.com/)
- [React 文档](https://react.dev/)
- [SQLite 文档](https://www.sqlite.org/docs.html)
- [node-cron 文档](https://www.npmjs.com/package/node-cron)
