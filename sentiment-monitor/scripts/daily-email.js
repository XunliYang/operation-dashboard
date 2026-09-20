#!/usr/bin/env node
/**
 * daily-email.js - 每日舆情邮件发送脚本
 * 用法: node scripts/daily-email.js [date]
 */

const path = require('path');
const fs = require('fs');

// 确保工作目录正确
const projectDir = path.resolve(__dirname, '..');
process.chdir(projectDir);

const mailer = require('../src/mailer');
const report = require('../src/report');

const date = process.argv[2] || new Date().toISOString().split('T')[0];
const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'config.json'), 'utf-8'));
const dataPath = path.join(projectDir, 'data', `${date}.json`);

let reportData;
if (fs.existsSync(dataPath)) {
  const data = JSON.parse(fs.readFileSync(dataPath));
  reportData = report.generateDailyReport(data);
} else {
  reportData = {
    date,
    keyword: config.keywords.join(', '),
    total: 0,
    platforms: {},
    items: [],
    summary: { total: 0, riskLevels: { high: 0, medium: 0, low: 0 }, sentiments: { positive: 0, negative: 0, neutral: 0 } },
    recommendations: ['今日无数据，建议检查采集流程'],
  };
}

(async () => {
  try {
    const result = await mailer.sendReport(date, reportData, config);
    console.log(`✅ 邮件发送成功: ${result.messageId}`);
  } catch (err) {
    console.error(`❌ 邮件发送失败: ${err.message}`);
    process.exit(1);
  }
})();
