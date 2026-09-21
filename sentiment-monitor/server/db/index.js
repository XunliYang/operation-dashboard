const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/sentiment.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

/**
 * LEOY-32：为 items 表补 (project_id, url) 唯一约束，让 collector.js 三处
 * `INSERT OR IGNORE INTO items` 真正按 URL 去重。
 *
 * 历史库可能已存在同 URL 重复条目，直接建唯一索引会失败，因此先清理重复行，
 * 保留 id 最小（最早采集）的一条。幂等：无重复时不删任何行，且
 * `CREATE UNIQUE INDEX IF NOT EXISTS` 可安全重入。
 *
 * 采用部分唯一索引（`WHERE url <> ''`）：空 URL 行不参与去重、显式保留，
 * 否则所有空 URL 行会被合并成一行。与 PR #27（LEOY-7 · P0-2）的
 * `003_dedupe_items_url.sql` 同语义、同索引名，二者合并后幂等不冲突。
 */
function migrateItemsUniqueIndex(database) {
  database.exec(`
    DELETE FROM items
    WHERE url <> ''
      AND id NOT IN (
        SELECT MIN(id) FROM items WHERE url <> '' GROUP BY project_id, url
      )
  `);
  database.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS uniq_items_project_url " +
      "ON items(project_id, url) WHERE url <> ''"
  );
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

    // 迁移：items 表 (project_id, url) 唯一索引（LEOY-32）
    migrateItemsUniqueIndex(db);
    
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

module.exports = { getDb, closeDb, migrateItemsUniqueIndex };