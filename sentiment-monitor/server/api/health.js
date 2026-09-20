const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const stats = db
    .prepare(
      `
    SELECT status, COUNT(DISTINCT source) as count
    FROM source_health
    WHERE project_id = ? AND date = date('now')
    GROUP BY status
  `
    )
    .all(projectId);

  const result = {
    normal: 0,
    anomaly: 0,
    disabled: 0,
  };

  stats.forEach(s => {
    result[s.status] = s.count;
  });

  const disabledCount = db
    .prepare('SELECT COUNT(*) as count FROM disabled_sources WHERE project_id = ?')
    .get(projectId);
  result.disabled = disabledCount.count;

  res.json(result);
});

router.get('/sources', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;
  const sourceType = req.query.sourceType; // 支持按类型筛选

  let sql = `
    SELECT source, link, source_type, date, raw_count, filtered_count, status, created_at
    FROM source_health sh1
    WHERE project_id = ? AND date = date('now')
    AND id = (
      SELECT MAX(id) FROM source_health sh2 
      WHERE sh2.project_id = sh1.project_id 
      AND sh2.source = sh1.source 
      AND sh2.date = sh1.date
    )
  `;
  
  const params = [projectId];
  
  // 如果指定了 sourceType，添加筛选条件
  if (sourceType) {
    sql += ' AND source_type = ?';
    params.push(sourceType);
  }
  
  sql += ' ORDER BY source';

  const sources = db.prepare(sql).all(...params);

  res.json(sources);
});

router.get('/trend', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const trend = db
    .prepare(
      `
    SELECT date, 
           SUM(raw_count) as total_raw,
           SUM(filtered_count) as total_filtered,
           COUNT(DISTINCT CASE WHEN status = 'anomaly' THEN source END) as anomaly_count
    FROM source_health
    WHERE project_id = ? AND date >= date('now', '-7 days')
    GROUP BY date
    ORDER BY date
  `
    )
    .all(projectId);

  res.json(trend);
});

module.exports = router;
