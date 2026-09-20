const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

// 更新 item
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { title, snippet, risk_level, sentiment } = req.body;
    
    const updates = [];
    const values = [];
    
    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (snippet !== undefined) {
      updates.push('snippet = ?');
      values.push(snippet);
    }
    if (risk_level !== undefined) {
      updates.push('risk_level = ?');
      values.push(risk_level);
    }
    if (sentiment !== undefined) {
      updates.push('sentiment = ?');
      values.push(sentiment);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: { message: '没有要更新的字段' } });
    }
    
    values.push(req.params.id);
    
    const result = db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Item 不存在' } });
    }
    
    logger.info('更新 item', { itemId: req.params.id, updates: req.body });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('更新 item 失败', error);
    res.status(500).json({ error: { message: '更新失败' } });
  }
});

// 标记 item 为已审核（加入汇总）
router.post('/:id/approve', (req, res) => {
  try {
    const db = getDb();
    
    const result = db.prepare(`
      UPDATE items 
      SET status = 'approved', is_summary = 1
      WHERE id = ?
    `).run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Item 不存在' } });
    }
    
    logger.info('审核通过 item', { itemId: req.params.id });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('审核 item 失败', error);
    res.status(500).json({ error: { message: '操作失败' } });
  }
});

// 标记 item 为拒绝/重复
router.post('/:id/reject', (req, res) => {
  try {
    const db = getDb();
    
    const result = db.prepare(`
      UPDATE items 
      SET status = 'rejected', is_summary = 0
      WHERE id = ?
    `).run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Item 不存在' } });
    }
    
    logger.info('拒绝 item', { itemId: req.params.id });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('拒绝 item 失败', error);
    res.status(500).json({ error: { message: '操作失败' } });
  }
});

// 批量操作
router.post('/batch', (req, res) => {
  try {
    const db = getDb();
    const { ids, action } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { message: '请提供 item ID 列表' } });
    }
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: { message: '无效的操作类型' } });
    }
    
    const placeholders = ids.map(() => '?').join(',');
    
    if (action === 'approve') {
      db.prepare(`
        UPDATE items 
        SET status = 'approved', is_summary = 1
        WHERE id IN (${placeholders})
      `).run(...ids);
    } else {
      db.prepare(`
        UPDATE items 
        SET status = 'rejected', is_summary = 0
        WHERE id IN (${placeholders})
      `).run(...ids);
    }
    
    logger.info('批量操作 items', { count: ids.length, action });
    
    res.json({ success: true, count: ids.length });
  } catch (error) {
    logger.error('批量操作失败', error);
    res.status(500).json({ error: { message: '操作失败' } });
  }
});

// 获取汇总页面数据
router.get('/summary', (req, res) => {
  try {
    const db = getDb();
    const { project_id } = req.query;
    
    let sql = `
      SELECT i.*, p.name as project_name, ch.started_at as collection_time
      FROM items i
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN collection_history ch ON i.collection_id = ch.id
      WHERE i.is_summary = 1
    `;
    const params = [];
    
    if (project_id) {
      sql += ' AND i.project_id = ?';
      params.push(project_id);
    }
    
    sql += ' ORDER BY i.created_at DESC';
    
    const items = db.prepare(sql).all(...params);
    
    res.json(items);
  } catch (error) {
    logger.error('获取汇总数据失败', error);
    res.status(500).json({ error: { message: '获取失败' } });
  }
});

// 从汇总中移除
router.post('/:id/remove-from-summary', (req, res) => {
  try {
    const db = getDb();
    
    const result = db.prepare(`
      UPDATE items 
      SET is_summary = 0
      WHERE id = ?
    `).run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Item 不存在' } });
    }
    
    logger.info('从汇总中移除 item', { itemId: req.params.id });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('从汇总中移除失败', error);
    res.status(500).json({ error: { message: '操作失败' } });
  }
});

module.exports = router;
