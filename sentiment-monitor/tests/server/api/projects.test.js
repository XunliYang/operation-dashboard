const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');

describe('Projects API', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM projects');
  });

  afterAll(() => {
    db.close();
  });

  describe('POST /api/projects', () => {
    it('应该创建新项目', async () => {
      const project = {
        name: 'test-project',
        config: {
          keywords: ['OpenAN'],
          rssSources: ['https://example.com/rss'],
        },
      };

      const res = await request(app)
        .post('/api/projects')
        .send(project)
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(Number),
        name: 'test-project',
        enabled: 1,
      });
    });

    it('项目名称必须唯一', async () => {
      const project = { name: 'duplicate', config: {} };

      await request(app).post('/api/projects').send(project).expect(201);
      await request(app).post('/api/projects').send(project).expect(409);
    });
  });

  describe('GET /api/projects', () => {
    it('应该返回项目列表', async () => {
      db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run(
        'project1',
        JSON.stringify({})
      );
      db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)').run(
        'project2',
        JSON.stringify({})
      );

      const res = await request(app).get('/api/projects').expect(200);

      expect(res.body).toHaveLength(2);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('应该返回项目详情', async () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('test', JSON.stringify({ keywords: ['test'] }));
      const id = result.lastInsertRowid;

      const res = await request(app).get(`/api/projects/${id}`).expect(200);

      expect(res.body.name).toBe('test');
      expect(res.body.config.keywords).toEqual(['test']);
    });

    it('项目不存在应返回 404', async () => {
      await request(app).get('/api/projects/999').expect(404);
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('应该更新项目', async () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('old-name', JSON.stringify({}));
      const id = result.lastInsertRowid;

      const res = await request(app)
        .put(`/api/projects/${id}`)
        .send({ name: 'new-name', config: { keywords: ['new'] } })
        .expect(200);

      expect(res.body.name).toBe('new-name');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('应该删除项目', async () => {
      const result = db
        .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
        .run('to-delete', JSON.stringify({}));
      const id = result.lastInsertRowid;

      await request(app).delete(`/api/projects/${id}`).expect(204);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      expect(project).toBeUndefined();
    });
  });
});
