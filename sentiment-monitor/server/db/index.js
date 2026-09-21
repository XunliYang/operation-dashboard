const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/sentiment.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db = null;

/**
 * 按序应用 `server/db/migrations/*.sql`，已应用的记录在 `_schema_migrations`。
 * 与 api/ 的 `python -m app.db.migrate` 同构：记录表 + 惰性应用，任何非预期错误上抛。
 *
 * 001/002 是「加列」迁移，而 schema.sql 已是其镜像（新库本身已含这些列），
 * 所以在全新库上重复加列会报 `duplicate column name` —— 视为已应用，不中断启动。
 */
function runMigrations(database) {
  database.exec(
    'CREATE TABLE IF NOT EXISTS _schema_migrations (' +
      '  name TEXT PRIMARY KEY,' +
      '  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP' +
      ');'
  );

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];

  const appliedSet = new Set(
    database.prepare('SELECT name FROM _schema_migrations').all().map((r) => r.name)
  );

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    try {
      database.exec('BEGIN');
      database.exec(sql);
      database.exec('COMMIT');
      database.prepare('INSERT INTO _schema_migrations (name) VALUES (?)').run(file);
      appliedSet.add(file);
    } catch (err) {
      try {
        database.exec('ROLLBACK');
      } catch (_) {
        // 无活动事务时忽略
      }
      if (typeof err.message === 'string' && err.message.includes('duplicate column name')) {
        database.prepare('INSERT INTO _schema_migrations (name) VALUES (?)').run(file);
        appliedSet.add(file);
      } else {
        throw err;
      }
    }
  }
}

function getDb() {
  if (!db) {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);

    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);

    runMigrations(db);

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

module.exports = { getDb, closeDb, runMigrations };