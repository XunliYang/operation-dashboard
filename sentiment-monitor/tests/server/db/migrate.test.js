const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../../../server/db');

const SCHEMA_PATH = path.join(__dirname, '../../../server/db/schema.sql');

/** 建一个只含 schema.sql 的干净库（无迁移、无唯一索引），用于验证迁移行为。 */
function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  return db;
}

function insertItem(db, projectId, fields) {
  const { url, title = 't' } = fields;
  return db
    .prepare(
      'INSERT INTO items (project_id, source, title, url, sentiment, status) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(projectId, 'weibo', title, url, 'neutral', 'approved').lastInsertRowid;
}

describe('Migration 003（采集去重）', () => {
  let db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('迁移后同 project_id + 相同非空 url 只保留一条（MIN(id)）', () => {
    const pid = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p', '{}').lastInsertRowid;
    const keep = insertItem(db, pid, { url: 'https://example.com/a' });
    insertItem(db, pid, { url: 'https://example.com/a' });
    insertItem(db, pid, { url: 'https://example.com/a' });

    runMigrations(db);

    const rows = db.prepare('SELECT id FROM items WHERE project_id = ?').all(pid);
    expect(rows.map((r) => r.id)).toEqual([keep]);
  });

  it('空 url 行不参与去重，全部保留', () => {
    const pid = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p', '{}').lastInsertRowid;
    insertItem(db, pid, { url: '' });
    insertItem(db, pid, { url: '' });
    insertItem(db, pid, { url: null });

    runMigrations(db);

    const { c } = db.prepare('SELECT COUNT(*) AS c FROM items WHERE project_id = ?').get(pid);
    expect(c).toBe(3);
  });

  it('不同 project 的相同 url 互不去重', () => {
    const p1 = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p1', '{}').lastInsertRowid;
    const p2 = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p2', '{}').lastInsertRowid;
    insertItem(db, p1, { url: 'https://example.com/same' });
    insertItem(db, p2, { url: 'https://example.com/same' });

    runMigrations(db);

    const { c } = db.prepare('SELECT COUNT(*) AS c FROM items').get();
    expect(c).toBe(2);
  });

  it('迁移幂等：重复执行不报错', () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('加唯一索引后重复插入非空 url 触发 SQLITE_CONSTRAINT（证明唯一性已生效）', () => {
    const pid = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p', '{}').lastInsertRowid;
    insertItem(db, pid, { url: 'https://example.com/u' });

    runMigrations(db);

    expect(() => insertItem(db, pid, { url: 'https://example.com/u' })).toThrow(/UNIQUE constraint failed/);
  });

  it('唯一索引排除空 url：可插入多条空 url 而不冲突', () => {
    const pid = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p', '{}').lastInsertRowid;
    runMigrations(db);

    expect(() => {
      insertItem(db, pid, { url: '' });
      insertItem(db, pid, { url: '' });
      insertItem(db, pid, { url: null });
    }).not.toThrow();
  });

  it('INSERT OR IGNORE 在唯一索引下静默忽略重复（采集路径不再翻倍）', () => {
    const pid = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run('p', '{}').lastInsertRowid;
    runMigrations(db);

    const stmt = db.prepare(
      `INSERT OR IGNORE INTO items (project_id, source, title, url, sentiment, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const run = () =>
      stmt.run(pid, 'weibo', 't', 'https://example.com/dup', 'neutral', 'pending');

    run();
    run(); // 第二次应被 OR IGNORE 静默吞掉，不抛异常

    const { c } = db.prepare('SELECT COUNT(*) AS c FROM items WHERE project_id = ?').get(pid);
    expect(c).toBe(1);
  });
});