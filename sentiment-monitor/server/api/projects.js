const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');
const notifier = require('../notifier');
const scheduler = require('../scheduler');

const router = express.Router();

// GET /api/projects - 项目列表
router.get('/', (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();

  const result = projects.map(p => ({
    ...p,
    config: JSON.parse(p.config),
  }));

  res.json(result);
});

// GET /api/projects/:id - 项目详情
router.get('/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

  if (!project) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }

  res.json({
    ...project,
    config: JSON.parse(project.config),
  });
});

// POST /api/projects - 创建项目
router.post('/', (req, res) => {
  const { name, config } = req.body;

  if (!name) {
    return res.status(400).json({ error: { message: '项目名称必填', code: 'VALIDATION_ERROR' } });
  }

  const db = getDb();

  try {
    const result = db
      .prepare('INSERT INTO projects (name, config) VALUES (?, ?)')
      .run(name, JSON.stringify(config || {}));

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);

    logger.info('创建项目', { projectId: project.id, name: project.name });
    
    // 重启调度器
    scheduler.restart();

    res.status(201).json({
      ...project,
      config: JSON.parse(project.config),
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: { message: '项目名称已存在', code: 'CONFLICT' } });
    }
    throw err;
  }
});

// PUT /api/projects/:id - 更新项目
router.put('/:id', (req, res) => {
  const { name, config, enabled } = req.body;
  const db = getDb();

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (config !== undefined) {
    updates.push('config = ?');
    values.push(JSON.stringify(config));
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);

    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    // 如果配置更新了，清除 notifier 缓存并重启 scheduler
    if (config !== undefined) {
      notifier.clearCache(parseInt(req.params.id));
      scheduler.restart();
      logger.info('项目配置已更新，已重启调度器', { projectId: req.params.id });
    }
  }

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

  logger.info('更新项目', { projectId: req.params.id, updates: req.body });

  res.json({
    ...updated,
    config: JSON.parse(updated.config),
  });
});

// DELETE /api/projects/:id - 删除项目
router.delete('/:id', (req, res) => {
  const db = getDb();

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

  logger.info('删除项目', { projectId: req.params.id, name: project.name });
  
  // 清除 notifier 缓存并重启调度器
  notifier.clearCache(parseInt(req.params.id));
  scheduler.restart();

  res.status(204).send();
});

// POST /api/projects/:id/enable - 启用项目
router.post('/:id/enable', (req, res) => {
  const db = getDb();

  const result = db
    .prepare('UPDATE projects SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }

  logger.info('启用项目', { projectId: req.params.id });
  
  // 重启调度器
  scheduler.restart();

  res.json({ success: true });
});

// POST /api/projects/:id/disable - 禁用项目
router.post('/:id/disable', (req, res) => {
  const db = getDb();

  const result = db
    .prepare('UPDATE projects SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
  }

  logger.info('禁用项目', { projectId: req.params.id });
  
  // 重启调度器
  scheduler.restart();

  res.json({ success: true });
});

module.exports = router;
