const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const logger = require('../logger');
const llmClient = require('../ai/llmClient');

const router = express.Router();

const RULES_PATH = path.join(__dirname, '../../config/decision-rules.json');

router.get('/rules', (req, res) => {
  try {
    const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: { message: '读取配置失败', code: 'CONFIG_ERROR' } });
  }
});

router.put('/rules', (req, res) => {
  try {
    fs.writeFileSync(RULES_PATH, JSON.stringify(req.body, null, 2));
    logger.info('更新决策规则', { rules: req.body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: { message: '保存配置失败', code: 'CONFIG_ERROR' } });
  }
});

router.get('/llm', (req, res) => {
  const db = getDb();
  const config = db.prepare("SELECT value FROM config WHERE key = 'llm_config'").get();

  if (config) {
    const llmConfig = JSON.parse(config.value);
    if (llmConfig.apiKey) {
      llmConfig.apiKey = '***' + llmConfig.apiKey.slice(-4);
    }
    res.json(llmConfig);
  } else {
    res.json({ enabled: false });
  }
});

router.put('/llm', (req, res) => {
  const db = getDb();
  const { apiKey, baseUrl, model, enabled } = req.body;

  const config = { apiKey, baseUrl, model, enabled };

  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('llm_config', ?)").run(
    JSON.stringify(config)
  );

  logger.info('更新 LLM 配置', { enabled, model });

  res.json({ success: true });
});

// 测试 LLM 连接
router.post('/llm/test', async (req, res) => {
  const { apiKey, baseUrl, model } = req.body;

  if (!apiKey || !baseUrl || !model) {
    return res.status(400).json({ error: { message: '缺少必要参数' } });
  }

  try {
    const result = await llmClient.chatCompletion({
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
      maxTokens: 5,
      config: { apiKey, baseUrl, model, enabled: true },
    });

    logger.info('LLM 连接测试成功', { model });
    res.json({ success: true, message: '连接成功', response: result.content });
  } catch (error) {
    logger.warn('LLM 连接测试失败', { error: error.message });
    res.status(error.statusCode || 400).json({ error: { message: '连接失败', detail: error.message } });
  }
});

router.get('/email', (req, res) => {
  const db = getDb();
  const config = db.prepare("SELECT value FROM config WHERE key = 'email_config'").get();

  if (config) {
    const emailConfig = JSON.parse(config.value);
    if (emailConfig.password) {
      emailConfig.password = '***';
    }
    res.json(emailConfig);
  } else {
    res.json({ enabled: false });
  }
});

router.put('/email', (req, res) => {
  const db = getDb();
  const config = req.body;

  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('email_config', ?)").run(
    JSON.stringify(config)
  );

  logger.info('更新邮件配置', { enabled: config.enabled, host: config.host });

  res.json({ success: true });
});

module.exports = router;
