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
    db.exec('DELETE FROM disabled_sources');
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
      const today = new Date().toISOString().slice(0, 10);

      db.prepare(
        'INSERT INTO source_health (project_id, source, date, raw_count, status) VALUES (?, ?, ?, ?, ?)'
      ).run(projectId, 'weibo', today, 10, 'normal');
      db.prepare(
        'INSERT INTO source_health (project_id, source, date, raw_count, status) VALUES (?, ?, ?, ?, ?)'
      ).run(projectId, 'bilibili', today, 0, 'anomaly');

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
      const today = new Date().toISOString().slice(0, 10);

      db.prepare(
        'INSERT INTO source_health (project_id, source, date, raw_count, filtered_count, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(projectId, 'weibo', today, 10, 8, 'normal');

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
      const now = new Date();

      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const date = d.toISOString().slice(0, 10);
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
