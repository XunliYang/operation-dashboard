const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');

function insertItem(db, projectId, fields) {
  const {
    source = 'weibo',
    title = 'title',
    url = null,
    timestamp = null,
    risk_level = null,
    sentiment = null,
  } = fields;
  return db
    .prepare(
      `INSERT INTO items (project_id, source, title, url, timestamp, risk_level, sentiment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(projectId, source, title, url, timestamp, risk_level, sentiment);
}

function daysAgo(n, hour = '10:00:00') {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.toISOString().slice(0, 10)} ${hour}`;
}

function today(hour = '10:00:00') {
  return `${new Date().toISOString().slice(0, 10)} ${hour}`;
}

describe('Hotspots API', () => {
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
      .run('hotspots-project', JSON.stringify({}));
    projectId = result.lastInsertRowid;
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/projects/:id/hotspots', () => {
    it('只返回当天的条目，历史条目被排除', async () => {
      insertItem(db, projectId, { title: 'today-1', url: 'https://example.com/today-1', timestamp: today() });
      insertItem(db, projectId, { title: 'yesterday-1', url: 'https://example.com/yesterday-1', timestamp: daysAgo(1) });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots`)
        .expect(200);

      const todayTitles = res.body.items.map(i => i.title);
      expect(todayTitles).toContain('today-1');
      expect(todayTitles).not.toContain('yesterday-1');
      expect(res.body.total).toBe(1);
    });

    it('按风险等级排序：高危在前，无评级在最后', async () => {
      insertItem(db, projectId, { title: 'low', risk_level: 'low', timestamp: today('09:00:00') });
      insertItem(db, projectId, { title: 'unrated', risk_level: null, timestamp: today('09:00:00') });
      insertItem(db, projectId, { title: 'high', risk_level: 'high', timestamp: today('09:00:00') });
      insertItem(db, projectId, { title: 'medium', risk_level: 'medium', timestamp: today('09:00:00') });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots`)
        .expect(200);

      expect(res.body.items.map(i => i.title)).toEqual([
        'high',
        'medium',
        'low',
        'unrated',
      ]);
    });

    it('同一风险等级按时间倒序排列', async () => {
      insertItem(db, projectId, { title: 'older', risk_level: 'high', timestamp: today('08:00:00') });
      insertItem(db, projectId, { title: 'newer', risk_level: 'high', timestamp: today('12:00:00') });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots`)
        .expect(200);

      expect(res.body.items.map(i => i.title)).toEqual(['newer', 'older']);
    });

    it('limit 参数限制返回条数，默认 10 条', async () => {
      for (let i = 0; i < 15; i++) {
        insertItem(db, projectId, { title: `item-${i}`, timestamp: today() });
      }

      const defaultRes = await request(app)
        .get(`/api/projects/${projectId}/hotspots`)
        .expect(200);
      expect(defaultRes.body.items).toHaveLength(10);

      const limitedRes = await request(app)
        .get(`/api/projects/${projectId}/hotspots?limit=3`)
        .expect(200);
      expect(limitedRes.body.items).toHaveLength(3);
    });

    it('非法 limit 回退为默认值，超大 limit 被截断到上限', async () => {
      for (let i = 0; i < 12; i++) {
        insertItem(db, projectId, { title: `item-${i}`, timestamp: today() });
      }

      const bad = await request(app)
        .get(`/api/projects/${projectId}/hotspots?limit=abc`)
        .expect(200);
      expect(bad.body.items).toHaveLength(10);

      const huge = await request(app)
        .get(`/api/projects/${projectId}/hotspots?limit=9999`)
        .expect(200);
      expect(huge.body.items).toHaveLength(12);
    });

    it('不返回其他项目的条目', async () => {
      const other = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('other-project', JSON.stringify({})).lastInsertRowid;
      insertItem(db, other, { title: 'other-project-item', timestamp: today() });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('空数据返回空列表而非报错', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('GET /api/projects/:id/hotspots/summary', () => {
    it('统计风险分布与情感分布', async () => {
      insertItem(db, projectId, { risk_level: 'high', sentiment: 'negative', timestamp: today() });
      insertItem(db, projectId, { risk_level: 'medium', sentiment: 'neutral', timestamp: today() });
      insertItem(db, projectId, { risk_level: 'low', sentiment: 'positive', timestamp: today() });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.risk).toEqual({ high: 1, medium: 1, low: 1, unrated: 0 });
      expect(res.body.sentiment).toEqual({ positive: 1, neutral: 1, negative: 1, unknown: 0 });
    });

    it('未识别的 sentiment 归入 unknown，未评级归入 risk.unrated', async () => {
      insertItem(db, projectId, { sentiment: 'angry', risk_level: null, timestamp: today() });
      insertItem(db, projectId, { sentiment: null, risk_level: null, timestamp: today() });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.sentiment.unknown).toBe(2);
      expect(res.body.risk.unrated).toBe(2);
    });

    it('来源分布按数量倒序聚合', async () => {
      insertItem(db, projectId, { source: 'weibo', timestamp: today() });
      insertItem(db, projectId, { source: 'weibo', timestamp: today() });
      insertItem(db, projectId, { source: 'bilibili', timestamp: today() });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.sources).toEqual([
        { source: 'weibo', count: 2 },
        { source: 'bilibili', count: 1 },
      ]);
      expect(res.body.sources_count).toBe(2);
    });

    it('历史条目不计入当天统计', async () => {
      insertItem(db, projectId, { sentiment: 'negative', timestamp: daysAgo(1) });
      insertItem(db, projectId, { sentiment: 'negative', timestamp: today() });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.negative_today).toBe(1);
    });

    it('负面量显著高于前 7 天基线时标记突增', async () => {
      // 前 7 天每天 1 条负面 → 基线均值 1
      for (let i = 1; i <= 7; i++) {
        insertItem(db, projectId, { sentiment: 'negative', timestamp: daysAgo(i) });
      }
      // 今天 5 条负面 ≥ 1 * 2 且 ≥ SPIKE_MIN_COUNT
      for (let i = 0; i < 5; i++) {
        insertItem(db, projectId, { sentiment: 'negative', timestamp: today() });
      }

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.negative_baseline_avg).toBe(1);
      expect(res.body.spike_detected).toBe(true);
    });

    it('样本不足时不误报突增', async () => {
      // 基线为 0（无历史负面），今天 2 条负面仍不应触发
      insertItem(db, projectId, { sentiment: 'negative', timestamp: today() });
      insertItem(db, projectId, { sentiment: 'negative', timestamp: today() });

      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.negative_baseline_avg).toBe(0);
      expect(res.body.spike_detected).toBe(false);
    });

    it('空项目返回零值统计且不除零崩溃', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/hotspots/summary`)
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.risk).toEqual({ high: 0, medium: 0, low: 0, unrated: 0 });
      expect(res.body.sentiment).toEqual({ positive: 0, neutral: 0, negative: 0, unknown: 0 });
      expect(res.body.sources).toEqual([]);
      expect(res.body.spike_detected).toBe(false);
    });
  });
});
