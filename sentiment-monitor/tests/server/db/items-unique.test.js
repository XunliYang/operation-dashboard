const Database = require('better-sqlite3');
const { getDb, migrateItemsUniqueIndex } = require('../../../server/db');

// 与 schema.sql 中 items 表一致的列结构（迁移只依赖 id/project_id/url）
function createItemsTable(db) {
  db.exec(`
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

describe('items 表 (project_id, url) 唯一约束（LEOY-32）', () => {
  describe('migrateItemsUniqueIndex 迁移', () => {
    it('清理已有重复 URL 条目并成功建立唯一索引', () => {
      const mem = new Database(':memory:');
      createItemsTable(mem);

      const insert = mem.prepare(
        'INSERT INTO items (project_id, source, url) VALUES (?, ?, ?)'
      );
      // 项目 1 中 A 重复两次、B 一次；项目 2 中同 URL A 一次（跨项目不算重复）
      insert.run(1, 'rss', 'https://a.example.com/1');
      insert.run(1, 'rss', 'https://a.example.com/1');
      insert.run(1, 'rss', 'https://b.example.com/2');
      insert.run(2, 'rss', 'https://a.example.com/1');

      migrateItemsUniqueIndex(mem);

      expect(mem.prepare('SELECT COUNT(*) c FROM items').get().c).toBe(3);
      expect(
        mem.prepare('SELECT COUNT(*) c FROM items WHERE project_id = 1').get().c
      ).toBe(2);

      const idx = mem
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_project_url'"
        )
        .all();
      expect(idx).toHaveLength(1);

      // 建索引后 INSERT OR IGNORE 对重复 (project_id, url) 生效
      mem
        .prepare(
          'INSERT OR IGNORE INTO items (project_id, source, url) VALUES (?, ?, ?)'
        )
        .run(1, 'rss', 'https://a.example.com/1');
      expect(mem.prepare('SELECT COUNT(*) c FROM items').get().c).toBe(3);
    });

    it('无重复数据时幂等，不误删', () => {
      const mem = new Database(':memory:');
      createItemsTable(mem);

      const insert = mem.prepare(
        'INSERT INTO items (project_id, source, url) VALUES (?, ?, ?)'
      );
      insert.run(1, 'rss', 'https://x.example.com/1');
      insert.run(1, 'rss', 'https://y.example.com/2');

      migrateItemsUniqueIndex(mem);
      migrateItemsUniqueIndex(mem);

      expect(mem.prepare('SELECT COUNT(*) c FROM items').get().c).toBe(2);
    });
  });

  describe('真实 getDb() 初始化', () => {
    it('初始化后 items 表具备唯一索引，INSERT OR IGNORE 去重生效', () => {
      const db = getDb();
      const idx = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_project_url'"
        )
        .all();
      expect(idx).toHaveLength(1);

      db.exec('DELETE FROM items');
      db.exec('DELETE FROM projects');
      const pid = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('uniq-test', '{}').lastInsertRowid;

      const stmt = db.prepare(
        `INSERT OR IGNORE INTO items
           (project_id, collection_id, source, source_type, title, url, snippet, timestamp, risk_level, sentiment, status)
         VALUES (?, ?, ?, 'rss', ?, ?, ?, ?, ?, ?, 'pending')`
      );
      const args = [pid, null, 'rss', 't', 'https://dup.example.com', '', new Date().toISOString(), 'low', 'neutral'];
      stmt.run(...args);
      stmt.run(...args);

      expect(
        db
          .prepare('SELECT COUNT(*) c FROM items WHERE project_id = ? AND url = ?')
          .get(pid, 'https://dup.example.com').c
      ).toBe(1);
    });
  });
});
