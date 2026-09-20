const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

// GET /api/decisions - 决策记录列表
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const projectId = req.query.projectId;

  let sql = 'SELECT * FROM decisions';
  const params = [];

  if (projectId) {
    sql += ' WHERE project_id = ?';
    params.push(projectId);
  }

  sql += ' ORDER BY executed_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const decisions = db.prepare(sql).all(...params);

  res.json(decisions);
});

// GET /api/decisions/:id - 决策详情
router.get('/:id', (req, res) => {
  const db = getDb();
  const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(req.params.id);

  if (!decision) {
    return res.status(404).json({ error: { message: '决策不存在', code: 'NOT_FOUND' } });
  }

  res.json(decision);
});

// POST /api/decisions/:id/undo - 撤销决策
router.post('/:id/undo', (req, res) => {
  const db = getDb();
  const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(req.params.id);

  if (!decision) {
    return res.status(404).json({ error: { message: '决策不存在', code: 'NOT_FOUND' } });
  }

  if (decision.action === 'disable_source') {
    db.prepare('DELETE FROM disabled_sources WHERE project_id = ? AND source = ?').run(
      decision.project_id,
      decision.target
    );

    logger.info('撤销决策：恢复源', {
      decisionId: decision.id,
      source: decision.target,
    });
  }

  db.prepare('DELETE FROM decisions WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});

module.exports = router;
