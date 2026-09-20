const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const LOG_DIR = path.join(__dirname, '../../data');

// 获取日志文件列表
router.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const stats = fs.statSync(path.join(LOG_DIR, file));
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime,
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json(files);
  } catch (error) {
    logger.error('获取日志文件列表失败', error);
    res.status(500).json({ error: { message: '获取日志文件列表失败' } });
  }
});

// 获取日志内容
router.get('/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { lines = 100, search = '' } = req.query;
    
    // 安全检查：确保文件名合法
    if (!filename.match(/^[a-zA-Z0-9\-_]+\.log$/)) {
      return res.status(400).json({ error: { message: '无效的文件名' } });
    }
    
    const filePath = path.join(LOG_DIR, filename);
    
    // 确保文件存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: { message: '日志文件不存在' } });
    }
    
    // 读取文件内容
    const content = fs.readFileSync(filePath, 'utf-8');
    let logLines = content.split('\n').filter(line => line.trim());
    
    // 搜索过滤
    if (search) {
      logLines = logLines.filter(line => 
        line.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    // 获取最后N行
    const lastLines = logLines.slice(-parseInt(lines));
    
    res.json({
      filename,
      totalLines: logLines.length,
      lines: lastLines,
    });
  } catch (error) {
    logger.error('获取日志内容失败', error);
    res.status(500).json({ error: { message: '获取日志内容失败' } });
  }
});

// 清空日志文件
router.delete('/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    // 安全检查
    if (!filename.match(/^[a-zA-Z0-9\-_]+\.log$/)) {
      return res.status(400).json({ error: { message: '无效的文件名' } });
    }
    
    const filePath = path.join(LOG_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: { message: '日志文件不存在' } });
    }
    
    // 清空文件内容
    fs.writeFileSync(filePath, '');
    
    logger.info('日志文件已清空', { filename });
    res.json({ success: true, message: '日志文件已清空' });
  } catch (error) {
    logger.error('清空日志文件失败', error);
    res.status(500).json({ error: { message: '清空日志文件失败' } });
  }
});

module.exports = router;
