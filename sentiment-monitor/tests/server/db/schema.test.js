const { getDb } = require('../../../server/db');

// LEOY-30 回归：source_health 表必须含 source_type 列，
// 否则 collector.insertHealth 与 health API 引用该列会抛
// "table source_health has no column named source_type"。
describe('source_health schema (LEOY-30)', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  afterAll(() => {
    db.close();
  });

  it('schema.sql 建出的 source_health 表包含 source_type 列', () => {
    const cols = db.prepare('PRAGMA table_info(source_health)').all();
    const names = cols.map((c) => c.name);
    expect(names).toContain('source_type');
  });

  it('insertHealth 形式的 INSERT（含 source_type）可成功写入', () => {
    db.exec('DELETE FROM source_health');
    db.exec('DELETE FROM projects');

    const { lastInsertRowid: projectId } = db
      .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run('leoy-30-test', JSON.stringify({}));

    const date = new Date().toISOString().slice(0, 10);
    expect(() =>
      db
        .prepare(
          `INSERT INTO source_health
             (project_id, source, link, source_type, date, raw_count, filtered_count, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(projectId, 'google-news', 'https://news.google.com/rss', 'google-news', date, 30, 30, 'normal')
    ).not.toThrow();

    const row = db
      .prepare('SELECT source_type, raw_count FROM source_health WHERE source = ?')
      .get('google-news');
    expect(row.source_type).toBe('google-news');
    expect(row.raw_count).toBe(30);
  });
});
