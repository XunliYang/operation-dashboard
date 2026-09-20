const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const report = require('./report');
const configLoader = require('./configLoader');
const { PLATFORM_CATEGORIES } = require('./report');

/**
 * 生成 PDF 报告
 * @param {string} date - 日期 YYYY-MM-DD
 * @returns {Promise<string>} PDF 文件路径
 */
async function generatePDF(date) {
  const dataPath = path.join(__dirname, '../data', `${date}.json`);
  if (!fs.existsSync(dataPath)) {
    throw new Error(`数据文件不存在: ${dataPath}`);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const reportData = report.generateDailyReport(data);
  
  const pdfDir = path.join(__dirname, '../pdf');
  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
  }

  const proj = configLoader.getProjectConfig();
  const pdfFilename = `${configLoader.renderTemplate(proj.pdfFilename, { name: proj.name, date }).replace(/\.pdf$/i, '')  }.pdf`;
  const pdfPath = path.join(pdfDir, pdfFilename);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(pdfPath));

  // 标题
  const reportTitle = configLoader.renderTemplate(proj.reportTitle, { displayName: proj.displayName }).replace(/^[^\w\u4e00-\u9fa5]+/, '');
  doc.fontSize(24).fillColor('#1F2937').text(reportTitle, { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).fillColor('#6B7280').text(date, { align: 'center' });
  doc.moveDown(2);

  // 统计概览
  doc.fontSize(16).fillColor('#1F2937').text('📊 统计概览');
  doc.moveDown(0.5);
  const { summary } = reportData;
  doc.fontSize(12).fillColor('#4B5563');
  doc.text(`总计: ${summary.total} 条`);
  doc.text(`风险等级: 高${summary.riskLevels?.high || 0} | 中${summary.riskLevels?.medium || 0} | 低${summary.riskLevels?.low || 0}`);
  doc.text(`情感分布: 正面${summary.sentiments?.positive || 0} | 中性${summary.sentiments?.neutral || 0} | 负面${summary.sentiments?.negative || 0}`);
  doc.moveDown();

  // 今日洞察
  if (reportData.recommendations && reportData.recommendations.length > 0) {
    doc.fontSize(16).fillColor('#1F2937').text('💡 今日洞察');
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#4B5563');
    reportData.recommendations.forEach(rec => {
      doc.text(`• ${rec}`);
    });
    doc.moveDown();
  }

  // 平台分类内容
  const cat = reportData.platformCategorized;
  if (cat) {
    for (const c of PLATFORM_CATEGORIES) {
      const info = cat[c.key];
      if (info && info.count > 0) {
        // 检查是否需要分页
        if (doc.y > 700) {
          doc.addPage();
        }
        
        doc.fontSize(14).fillColor('#374151').text(`${c.label} (${info.count}条)`);
        doc.moveDown(0.5);
        
        info.items.forEach(item => {
          if (doc.y > 750) {
            doc.addPage();
          }
          
          doc.fontSize(11).fillColor('#2563EB').text(`• ${item.title}`, {
            link: item.url,
            underline: true,
          });
          
          if (item.timestamp) {
            const timeStr = new Date(item.timestamp).toISOString().replace('T', ' ').substring(0, 16);
            doc.fontSize(9).fillColor('#9CA3AF').text(`  ${timeStr} | ${item.risk_level}风险 | ${item.sentiment}`, {
              indent: 20,
            });
          }
          
          if (item.summary) {
            doc.fontSize(10).fillColor('#6B7280').text(`  ${item.summary.substring(0, 150)}`, {
              indent: 20,
            });
          }
          
          doc.moveDown(0.3);
        });
        
        doc.moveDown(0.5);
      }
    }
  }

  // 页脚
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#9CA3AF').text(
    `${proj.displayName} Monitor · 自动生成于 ${new Date().toISOString()}`,
    { align: 'center' },
  );

  doc.end();

  return new Promise((resolve, reject) => {
    setTimeout(() => resolve(pdfPath), 500);
  });
}

module.exports = generatePDF;
