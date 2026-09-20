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
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({}));
      const projectId = result.lastInsertRowid;

      for (let i = 0; i < 3; i++) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
