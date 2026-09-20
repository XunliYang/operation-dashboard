#!/usr/bin/env node
/**
 * generate-pdf.js - 生成 PDF 报告
 * 使用 pdfkit 直接生成 PDF（无需浏览器）
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const report = require('../src/report');
const configLoader = require('../src/configLoader');

// 风险等级配色
const RISK_COLORS = {
  high: { bg: '#FEE2E2', text: '#991B1B', label: '高风险' },
  medium: { bg: '#FEF3C7', text: '#92400E', label: '中风险' },
  low: { bg: '#D1FAE5', text: '#065F46', label: '低风险' },
};

function formatTimestamp(timestamp) {
  if (!timestamp) {return '';}
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {return '';}
    return d.toISOString().replace('T', ' ').substring(0, 16);
  } catch { return ''; }
}

async function generatePDF(date) {
  const dataDir = path.join(__dirname, '..', 'data');
  const dataPath = path.join(dataDir, `${date}.json`);
  
  if (!fs.existsSync(dataPath)) {
    console.log(`❌ 数据文件不存在: ${dataPath}`);
    return null;
  }

  const data = JSON.parse(fs.readFileSync(dataPath));
  const reportData = report.generateDailyReport(data);

  // 创建 PDF 目录
  const pdfDir = path.join(__dirname, '..', 'pdf');
  if (!fs.existsSync(pdfDir)) {fs.mkdirSync(pdfDir, { recursive: true });}

  const proj = configLoader.getProjectConfig();
  const pdfPath = path.join(pdfDir, configLoader.renderTemplate(proj.pdfFilename, { name: proj.name, date }));
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const { summary, platformCategorized, highRiskItems, recommendations } = reportData;
  
  // 标题
  doc.fontSize(24).fillColor('#667EEA').text(configLoader.renderTemplate(proj.reportTitle, { displayName: proj.displayName }), { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#6B7280').text(`📅 ${date}`, { align: 'center' });
  doc.moveDown(2);

  // 统计概览
  doc.fontSize(16).fillColor('#1F2937').text('📊 统计概览', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#4B5563');
  doc.text(`总计: ${summary.total} 条`);
  doc.text(`风险等级: 高 ${summary.riskLevels?.high || 0} | 中 ${summary.riskLevels?.medium || 0} | 低 ${summary.riskLevels?.low || 0}`);
  doc.text(`情感分布: 👍 ${summary.sentiments?.positive || 0} | ➖ ${summary.sentiments?.neutral || 0} | 👎 ${summary.sentiments?.negative || 0}`);
  doc.moveDown(1.5);

  // 高风险内容
  if (highRiskItems && highRiskItems.length > 0) {
    doc.fontSize(16).fillColor('#991B1B').text('⚠️ 高风险内容', { underline: true });
    doc.moveDown(0.5);
    for (const item of highRiskItems) {
      doc.fontSize(11).fillColor('#1F2937').text(`• ${item.title}`, { link: item.url });
      doc.fontSize(10).fillColor('#6B7280').text(`  ${item.platform} | ${formatTimestamp(item.timestamp)}`);
      if (item.summary) {doc.text(`  ${item.summary.substring(0, 100)}`, { lineBreak: true });}
      doc.moveDown(0.3);
    }
    doc.moveDown(1);
  }

  // 平台分类内容
  const { PLATFORM_CATEGORIES } = require('../src/report');
  doc.fontSize(16).fillColor('#1F2937').text('📋 平台分栏', { underline: true });
  doc.moveDown(0.5);

  for (const cat of PLATFORM_CATEGORIES) {
    const info = platformCategorized?.[cat.key];
    if (!info || info.count === 0) {continue;}

    doc.fontSize(13).fillColor('#3730A3').text(`── ${cat.label} (${info.count}条)`);
    doc.moveDown(0.3);

    for (const item of info.items) {
      doc.fontSize(11).fillColor('#1F2937').text(`• ${item.title}`, { link: item.url });
      const timeStr = formatTimestamp(item.timestamp);
      let riskLabel;
      if (item.risk_level === 'high') {
        riskLabel = ' 🔴';
      } else if (item.risk_level === 'medium') {
        riskLabel = ' 🟡';
      } else {
        riskLabel = ' 🟢';
      }
      doc.fontSize(10).fillColor('#6B7280').text(`  ${timeStr}${riskLabel}`);
      if (item.summary) {
        doc.fontSize(10).fillColor('#4B5563').text(`  ${item.summary.substring(0, 120)}`, { lineBreak: true });
      }
      doc.moveDown(0.3);
    }
    doc.moveDown(0.8);
  }

  // 建议
  if (recommendations && recommendations.length > 0) {
    if (doc.y > 650) {doc.addPage();}
    doc.fontSize(16).fillColor('#92400E').text('💡 建议', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#374151');
    for (const rec of recommendations) {
      doc.text(`• ${rec}`);
      doc.moveDown(0.2);
    }
  }

  // 页脚
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#9CA3AF').text(
    `${proj.displayName} Monitor · 自动生成于 ${new Date().toISOString()}`,
    { align: 'center' },
  );

  doc.end();

  return new Promise((resolve) => {
    stream.on('finish', () => {
      console.log(`✅ PDF 已生成: ${pdfPath}`);
      resolve(pdfPath);
    });
  });
}

// CLI
const date = process.argv[2] || new Date().toISOString().split('T')[0];
generatePDF(date).then(pdfPath => {
  if (pdfPath) {console.log('PDF路径:', pdfPath);}
}).catch(err => {
  console.error('生成失败:', err.message);
  process.exit(1);
});
