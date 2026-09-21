const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');

describe('P0-1 凭据剥离（GET /api/projects）', () => {
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

  const CONFIG_WITH_CREDS = {
    keywords: ['OpenAN'],
    email: {
      enabled: true,
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'user@example.com', pass: 'super-secret-pass' },
      },
      to: ['recipient@example.com'],
    },
  };

  it('列表接口不返回 smtp.auth.pass（响应 JSON 中无任何 pass）', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'with-creds', config: CONFIG_WITH_CREDS })
      .expect(201);
    expect(created.body.id).toEqual(expect.any(Number));

    const res = await request(app).get('/api/projects').expect(200);

    expect(res.body).toHaveLength(1);
    const raw = JSON.stringify(res.body);
    expect(raw.toLowerCase()).not.toContain('pass');
    expect(raw).not.toContain('super-secret-pass');
    expect(res.body[0].config.email.smtp).toBeUndefined();
  });

  it('详情接口同样剥离 email.smtp', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'detail-creds', config: CONFIG_WITH_CREDS })
      .expect(201);

    const res = await request(app).get(`/api/projects/${created.body.id}`).expect(200);

    expect(res.body.config.email.smtp).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');
  });

  it('DB 内仍保留完整配置（仅输出脱敏，不影响 notifier 取凭据）', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'stored-creds', config: CONFIG_WITH_CREDS })
      .expect(201);

    const row = db.prepare('SELECT config FROM projects WHERE id = ?').get(created.body.id);
    expect(JSON.parse(row.config).email.smtp.auth.pass).toBe('super-secret-pass');
  });
});