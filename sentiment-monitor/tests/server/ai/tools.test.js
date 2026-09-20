const { getDb } = require('../../../server/db');
const { executeTool, getToolDefinitions } = require('../../../server/ai/tools');

describe('AI Tools', () => {
  let db;
  let projectId;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM projects');
    const result = db.prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run('ai-test', JSON.stringify({
        keywords: ['OpenAN'],
        sites: [{ platform: 'zhihu', query: 'site:zhihu.com' }],
        rssSources: ['https://example.com/rss'],
        keywordConfig: { daysBack: 3, todayOnly: false },
      }));
    projectId = result.lastInsertRowid;
  });

  afterAll(() => {
    db.close();
  });

  const call = (name, args) =>
    executeTool({ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } });

  const readConfig = (id) =>
    JSON.parse(db.prepare('SELECT config FROM projects WHERE id = ?').get(id).config);

  it('add_site 添加站点', () => {
    const res = call('add_site', { project_id: projectId, platform: 'weibo', query: 'site:weibo.com' });
    expect(res.success).toBe(true);
    expect(readConfig(projectId).sites).toContainEqual({ platform: 'weibo', query: 'site:weibo.com' });
  });

  it('remove_site 删除站点', () => {
    const res = call('remove_site', { project_id: projectId, platform: 'zhihu' });
    expect(res.success).toBe(true);
    expect(readConfig(projectId).sites).toHaveLength(0);
  });

  it('add_keyword 添加关键词并去重', () => {
    call('add_keyword', { project_id: projectId, keyword: 'OpenAN' });
    call('add_keyword', { project_id: projectId, keyword: 'NewKW' });
    expect(readConfig(projectId).keywords).toEqual(['OpenAN', 'NewKW']);
  });

  it('update_collection_config 修改 daysBack', () => {
    const res = call('update_collection_config', { project_id: projectId, daysBack: 7 });
    expect(res.success).toBe(true);
    expect(readConfig(projectId).keywordConfig.daysBack).toBe(7);
  });

  it('delete_project 无 confirm 时拒绝', () => {
    const res = call('delete_project', { project_id: projectId });
    expect(res.success).toBe(false);
    expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)).toBeDefined();
  });

  it('delete_project confirm=true 删除项目', () => {
    const res = call('delete_project', { project_id: projectId, confirm: true });
    expect(res.success).toBe(true);
    expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)).toBeUndefined();
  });

  it('getToolDefinitions 返回 type=function 定义', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBeTruthy();
  });

  it('list_items 裁剪字段并限制条数', () => {
    for (let i = 0; i < 25; i++) {
      db.prepare("INSERT INTO items (project_id, source, title, url, timestamp) VALUES (?, ?, ?, ?, ?)")
        .run(projectId, 'google-news', `标题标题标题${i}`, `https://example.com/${i}`, `2026-08-01T00:${String(i).padStart(2, '0')}:00Z`);
    }
    const res = call('list_items', { project_id: projectId });
    expect(res.success).toBe(true);
    expect(res.result.items).toHaveLength(10);
    expect(res.result.items[0]).not.toHaveProperty('snippet');
    expect(res.result.items[0]).toHaveProperty('title');
    expect(res.result.items[0]).toHaveProperty('source');
    expect(res.result.items[0]).toHaveProperty('timestamp');
  });
});