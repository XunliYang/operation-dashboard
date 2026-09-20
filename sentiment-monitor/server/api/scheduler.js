const express = require('express');
const router = express.Router();
const scheduler = require('../scheduler');
const { getDb } = require('../db');
const logger = require('../logger');

// 获取调度器状态
router.get('/status', (req, res) => {
  try {
    const status = scheduler.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('获取调度器状态失败', error);
    res.status(500).json({ error: { message: '获取状态失败' } });
  }
});

// 手动触发采集
router.post('/trigger', async (req, res) => {
  try {
    const { projectId } = req.body;
    
    if (!projectId) {
      return res.status(400).json({ error: { message: '缺少项目 ID' } });
    }
    
    logger.info('手动触发采集任务', { projectId });
    
    // 异步执行采集任务
    scheduler.triggerManualCollection(projectId)
      .then(result => {
        logger.info('手动采集任务完成', { projectId, result });
      })
      .catch(error => {
        logger.error('手动采集任务失败', { projectId, error: error.message });
      });
    
    // 立即返回成功
    res.json({ success: true, message: '采集任务已启动' });
  } catch (error) {
    logger.error('触发采集任务失败', error);
    res.status(500).json({ error: { message: '触发任务失败' } });
  }
});

// 重启调度器（当项目配置更新时调用）
router.post('/restart', (req, res) => {
  try {
    scheduler.restart();
    res.json({ success: true, message: '调度器已重启' });
  } catch (error) {
    logger.error('重启调度器失败', error);
    res.status(500).json({ error: { message: '重启失败' } });
  }
});

module.exports = router;
