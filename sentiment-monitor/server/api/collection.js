const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const logger = require('../logger');

// 获取采集历史
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { project_id, limit = 20 } = req.query;
    
    let sql = `
      SELECT ch.*, p.name as project_name 
      FROM collection_history ch
      LEFT JOIN projects p ON ch.project_id = p.id
    `;
    const params = [];
    
    if (project_id) {
      sql += ' WHERE ch.project_id = ?';
      params.push(project_id);
    }
    
    sql += ' ORDER BY ch.started_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const history = db.prepare(sql).all(...params);
    
    res.json(history);
  } catch (error) {
    logger.error('获取采集历史失败', error);
    res.status(500).json({ error: { message: '获取采集历史失败' } });
  }
});

// 获取单个采集记录详情（包含该次采集的 items）
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    
    const history = db.prepare(`
      SELECT ch.*, p.name as project_name 
      FROM collection_history ch
      LEFT JOIN projects p ON ch.project_id = p.id
      WHERE ch.id = ?
    `).get(req.params.id);
    
    if (!history) {
      return res.status(404).json({ error: { message: '采集记录不存在' } });
    }
    
    // 获取该次采集的 items
    const items = db.prepare(`
      SELECT * FROM items 
      WHERE collection_id = ?
      ORDER BY timestamp DESC
    `).all(req.params.id);
    
    res.json({
      ...history,
      items
    });
  } catch (error) {
    logger.error('获取采集记录详情失败', error);
    res.status(500).json({ error: { message: '获取采集记录详情失败' } });
  }
});

module.exports = router;
