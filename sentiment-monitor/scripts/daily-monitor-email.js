#!/usr/bin/env node
/**
 * daily-monitor-email.js - 采集 + 报告 + 发邮件（一体化脚本）
 * 用法: node scripts/daily-monitor-email.js [date]
 */

const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
process.chdir(projectDir);

const report = require('../src/report');
const storage = require('../src/storage');
const mailer = require('../src/mailer');

const date = process.argv[2] || new Date().toISOString().split('T')[0];
const dataPath = path.join(projectDir, 'data', `${date}.json`);

(async () => {
  try {
    const sourceStats = storage.loadSourceStats(date);
    let reportData;
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath));
      reportData = report.generateDailyReport(data, sourceStats);
    } else {
      const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'config.json'), 'utf-8'));
      reportData = {
        date,
        keyword: config.keywords.join(', '),
        total: 0,
        platforms: {},
        items: [],
        summary: { total: 0, riskLevels: { high: 0, medium: 0, low: 0 }, sentiments: { positive: 0, negative: 0, neutral: 0 } },
        recommendations: ['今日无数据，建议检查采集流程'],
        sourceStats,
        sourceGrouped: {},
      };
    }

    console.log(`📊 报告统计: ${reportData.summary?.total || reportData.total || 0} 条数据`);
    console.log(`   高风险: ${reportData.summary.riskLevels.high} | 中风险: ${reportData.summary.riskLevels.medium} | 低风险: ${reportData.summary.riskLevels.low}`);

    const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'config.json'), 'utf-8'));
    const result = await mailer.sendReport(date, reportData, config);
    console.log(`✅ 邮件发送成功: ${result.messageId}`);
  } catch (err) {
    console.error(`❌ 失败: ${err.message}`);
    process.exit(1);
  }
})();
