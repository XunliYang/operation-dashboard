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
  collection_id INTEGER,
  source TEXT NOT NULL,
  source_type TEXT,
  title TEXT,
  url TEXT,
  snippet TEXT,
  timestamp DATETIME,
  risk_level TEXT,
  sentiment TEXT,
  status TEXT DEFAULT 'pending',
  is_summary INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collection_history(id) ON DELETE SET NULL
);

-- 数据源健康度
CREATE TABLE IF NOT EXISTS source_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  link TEXT,
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

CREATE TABLE IF NOT EXISTS collection_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  items_count INTEGER DEFAULT 0,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  error_message TEXT,
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

-- LEOY-32：items 表的 (project_id, url) 唯一索引不放在本文件，而是在
-- server/db/index.js 的 migrateItemsUniqueIndex() 中迁移创建。原因：历史库
-- 可能已存在同 URL 重复条目，需先去重再建唯一索引，故不能在此直接 CREATE UNIQUE INDEX。
-- 唯一索引为部分索引（WHERE url <> ''），空 URL 行不参与去重。
