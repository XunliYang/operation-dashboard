const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');

function insertItem(db, projectId, fields) {
  const {
    source = 'weibo',
    title = 'title',
    url = null,
    timestamp = null,
    sentiment = 'neutral',
    status = 'approved',
  } = fields;
  return db
    .prepare(
      `INSERT INTO items (project_id, source, title, url, timestamp, sentiment, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, source, title, url, timestamp, sentiment, status);
}

describe('Sentiment stats API (§5.3)', () => {
  let db;
  let projectId;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM items');
    db.exec('DELETE FROM projects');
    const result = db
      .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run('sentiment-project', JSON.stringify({ keywords: ['OpenAN'] }));
    projectId = result.lastInsertRowid;
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/projects/:id/sentiment/stats', () => {
    it('空项目返回 total=0、score=0、ratio 全 0，不除零崩溃', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.score).toBe(0);
      expect(res.body.distribution).toEqual({ positive: 0, neutral: 0, negative: 0 });
      expect(res.body.ratio).toEqual({ positive: 0, neutral: 0, negative: 0 });
      expect(res.body.daily).toEqual([]);
      expect(res.body.platforms).toEqual([]);
      expect(res.body.spike_detected).toBe(false);
      expect(res.body.last_updated).toBeNull();
    });

    it('全中性时 score=0，ratio.neutral=1', async () => {
      insertItem(db, projectId, { sentiment: 'neutral', timestamp: '2026-09-16 10:00:00' });
      insertItem(db, projectId, { sentiment: 'neutral', timestamp: '2026-09-16 11:00:00' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-30`)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.score).toBe(0);
      expect(res.body.ratio.neutral).toBe(1);
    });

    it('聚合正/中/负分布、score=(pos-neg)/total、来源分布', async () => {
      insertItem(db, projectId, { sentiment: 'positive', source: 'weibo', timestamp: '2026-09-16 10:00:00' });
      insertItem(db, projectId, { sentiment: 'positive', source: 'weibo', timestamp: '2026-09-16 11:00:00' });
      insertItem(db, projectId, { sentiment: 'negative', source: 'bilibili', timestamp: '2026-09-16 12:00:00' });
      insertItem(db, projectId, { sentiment: 'neutral', source: 'weibo', timestamp: '2026-09-16 13:00:00' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-30`)
        .expect(200);

      expect(res.body.total).toBe(4);
      expect(res.body.distribution).toEqual({ positive: 2, neutral: 1, negative: 1 });
      expect(res.body.score).toBeCloseTo((2 - 1) / 4, 5);
      expect(res.body.ratio.positive).toBeCloseTo(0.5, 4);
      expect(res.body.platforms).toEqual([
        { source: 'weibo', count: 3 },
        { source: 'bilibili', count: 1 },
      ]);
    });

    it('跨月区间分日计数之和等于 total（Σ daily.total = total）', async () => {
      insertItem(db, projectId, { sentiment: 'positive', timestamp: '2026-08-31 23:00:00' });
      insertItem(db, projectId, { sentiment: 'negative', timestamp: '2026-08-31 09:00:00' });
      insertItem(db, projectId, { sentiment: 'neutral', timestamp: '2026-09-01 00:30:00' });
      insertItem(db, projectId, { sentiment: 'negative', timestamp: '2026-09-01 08:00:00' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-08-31&to=2026-09-01`)
        .expect(200);

      expect(res.body.total).toBe(4);
      expect(res.body.daily).toHaveLength(2);
      const dailySum = res.body.daily.reduce((sum, d) => sum + d.total, 0);
      expect(dailySum).toBe(res.body.total);
      expect(res.body.daily[0].date).toBe('2026-08-31');
      expect(res.body.daily[1].date).toBe('2026-09-01');
    });

    it('from/to 之外的条目被排除', async () => {
      insertItem(db, projectId, { sentiment: 'positive', timestamp: '2026-09-16 10:00:00' });
      insertItem(db, projectId, { sentiment: 'positive', timestamp: '2026-07-01 10:00:00' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-30`)
        .expect(200);

      expect(res.body.total).toBe(1);
    });

    it('默认只统计 status=approved；未审核条目不纳入', async () => {
      insertItem(db, projectId, { sentiment: 'positive', status: 'approved', timestamp: '2026-09-16 10:00:00' });
      insertItem(db, projectId, { sentiment: 'negative', status: 'pending', timestamp: '2026-09-16 11:00:00' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-30`)
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.distribution.negative).toBe(0);

      const allRes = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-30&status=all`)
        .expect(200);
      expect(allRes.body.total).toBe(2);
      expect(allRes.body.distribution.negative).toBe(1);
    });

    it('未识别的 sentiment 归入 neutral', async () => {
      insertItem(db, projectId, { sentiment: 'angry', timestamp: '2026-09-16 10:00:00' });
      insertItem(db, projectId, { sentiment: null, timestamp: '2026-09-16 11:00:00' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-30`)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.distribution.neutral).toBe(2);
      expect(res.body.score).toBe(0);
    });

    it('负面量显著高于前 7 天基线时标记突增', async () => {
      // 前 7 天每天 1 条负面
      for (let i = 7; i >= 1; i--) {
        insertItem(db, projectId, { sentiment: 'negative', timestamp: `2026-09-${String(9 + i).padStart(2, '0')} 09:00:00` });
      }
      // 最新一天 5 条负面
      for (let i = 0; i < 5; i++) {
        insertItem(db, projectId, { sentiment: 'negative', timestamp: '2026-09-17 10:00:00' });
      }

      const res = await request(app)
        .get(`/api/projects/${projectId}/sentiment/stats?from=2026-09-01&to=2026-09-17`)
        .expect(200);

      expect(res.body.spike_detected).toBe(true);
    });

    it('不存在的项目返回 404', async () => {
      await request(app).get('/api/projects/99999/sentiment/stats').expect(404);
    });
  });
});