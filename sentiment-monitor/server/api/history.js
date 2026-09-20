const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router({ mergeParams: true });

// GET /api/projects/:id/items - 采集记录（分页）
router.get('/items', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const source = req.query.source;
  const riskLevel = req.query.riskLevel;

  let sql = 'SELECT * FROM items WHERE project_id = ?';
  const params = [projectId];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  if (riskLevel) {
    sql += ' AND risk_level = ?';
    params.push(riskLevel);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params);

  // 获取总数
  let countSql = 'SELECT COUNT(*) as total FROM items WHERE project_id = ?';
  const countParams = [projectId];

  if (source) {
    countSql += ' AND source = ?';
    countParams.push(source);
  }

  if (riskLevel) {
    countSql += ' AND risk_level = ?';
    countParams.push(riskLevel);
  }

  const { total } = db.prepare(countSql).get(...countParams);

  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /api/projects/:id/items/stats - 统计信息
router.get('/items/stats', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const stats = db
    .prepare(
      `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_risk,
      COUNT(CASE WHEN risk_level = 'medium' THEN 1 END) as medium_risk,
      COUNT(CASE WHEN risk_level = 'low' THEN 1 END) as low_risk,
      COUNT(DISTINCT source) as sources
    FROM items
    WHERE project_id = ? AND date(timestamp) = date('now')
  `
    )
    .get(projectId);

  res.json(stats);
});

// POST /api/projects/:id/items/export - 导出数据
router.post('/items/export', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;
  const { startDate, endDate, format } = req.body;

  let sql = 'SELECT * FROM items WHERE project_id = ?';
  const params = [projectId];

  if (startDate) {
    sql += ' AND date(timestamp) >= ?';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND date(timestamp) <= ?';
    params.push(endDate);
  }

  sql += ' ORDER BY timestamp DESC';

  const items = db.prepare(sql).all(...params);

  if (format === 'csv') {
    // 简单 CSV 导出
    const headers = ['id', 'source', 'title', 'url', 'timestamp', 'risk_level'];
    const csv = [
      headers.join(','),
      ...items.map(item =>
        headers.map(h => `"${(item[h] || '').toString().replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=export.csv');
    res.send(csv);
  } else {
    res.json(items);
  }
});

module.exports = router;
