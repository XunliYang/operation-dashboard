/**
 * feedback.js - 舆情监控反馈持久化模块
 * 记录每次运行的反馈信息，用于持续优化
 */

const fs = require('fs');
const path = require('path');

// 反馈数据文件路径
const FEEDBACK_FILE = path.join(__dirname, '..', 'data', 'feedback.json');

/**
 * 确保数据目录存在
 */
function ensureDataDir() {
  const dataDir = path.dirname(FEEDBACK_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[feedback] 创建数据目录: ${dataDir}`);
  }
}

/**
 * 加载所有反馈记录
 * @returns {Object} 反馈数据对象
 */
function loadFeedback() {
  ensureDataDir();
  
  if (!fs.existsSync(FEEDBACK_FILE)) {
    return {
      records: [],
      metadata: {
        created: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
    };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8'));
    return data;
  } catch (error) {
    console.warn(`[feedback] 读取反馈文件失败: ${error.message}`);
    return {
      records: [],
      metadata: {
        created: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
    };
  }
}

/**
 * 保存反馈记录
 * @param {Object} entry - 单条反馈记录
 * @param {string} entry.date - 日期 (YYYY-MM-DD)
 * @param {number} entry.totalItems - 总条目数
 * @param {number} entry.highRiskCount - 高风险条目数
 * @param {string} entry.userFeedback - 用户反馈（可选）
 * @param {string} entry.optimizationNotes - 优化建议（可选）
 * @param {Object} entry.stats - 数据源统计（可选）
 * @param {Object} entry.sourceHealth - 数据源健康度（可选）{ sourceId: { rawCount, filteredCount } }
 * @returns {Object} 更新后的反馈数据
 */
function saveFeedback(entry) {
  ensureDataDir();
  
  // 验证必填字段
  if (!entry.date) {
    throw new Error('[feedback] 日期字段必填');
  }
  
  const data = loadFeedback();
  
  // 检查是否已存在同日记录
  const existingIndex = data.records.findIndex(r => r.date === entry.date);
  
  const record = {
    date: entry.date,
    totalItems: entry.totalItems || 0,
    highRiskCount: entry.highRiskCount || 0,
    userFeedback: entry.userFeedback || '',
    optimizationNotes: entry.optimizationNotes || '',
    stats: entry.stats || {},
    sourceHealth: entry.sourceHealth || null,
    timestamp: new Date().toISOString(),
  };
  
  if (existingIndex >= 0) {
    // 更新现有记录
    data.records[existingIndex] = record;
    console.log(`[feedback] 更新反馈记录: ${entry.date}`);
  } else {
    // 追加新记录
    data.records.push(record);
    console.log(`[feedback] 新增反馈记录: ${entry.date}`);
  }
  
  // 按日期排序（最新的在前）
  data.records.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // 更新元数据
  data.metadata = data.metadata || {};
  data.metadata.last_updated = new Date().toISOString();
  data.metadata.total_records = data.records.length;
  
  // 保存文件
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[feedback] 反馈已保存到 ${FEEDBACK_FILE}`);
  
  return data;
}

/**
 * 获取指定日期范围的反馈记录
 * @param {string} startDate - 开始日期 (YYYY-MM-DD)
 * @param {string} endDate - 结束日期 (YYYY-MM-DD)
 * @returns {Array} 反馈记录数组
 */
function getFeedbackInRange(startDate, endDate) {
  const data = loadFeedback();
  
  return data.records.filter(r => {
    return r.date >= startDate && r.date <= endDate;
  });
}

/**
 * 获取最近的反馈记录
 * @param {number} count - 记录数量
 * @returns {Array} 反馈记录数组
 */
function getRecentFeedback(count = 7) {
  const data = loadFeedback();
  return data.records.slice(0, count);
}

/**
 * 获取最近 N 天的数据源健康度数据
 * @param {number} days - 天数（默认 7）
 * @returns {Object} { sourceId: { counts: [number], avg: number } }
 */
function getSourceHealthHistory(days = 7) {
  const data = loadFeedback();
  const recent = data.records.slice(0, days);
  
  const sourceHistory = {};
  
  for (const record of recent) {
    if (!record.sourceHealth) {continue;}
    
    for (const [sourceId, health] of Object.entries(record.sourceHealth)) {
      if (!sourceHistory[sourceId]) {
        sourceHistory[sourceId] = { counts: [], avg: 0 };
      }
      sourceHistory[sourceId].counts.push(health.rawCount || 0);
    }
  }
  
  // 计算平均值
  for (const sourceId of Object.keys(sourceHistory)) {
    const counts = sourceHistory[sourceId].counts;
    if (counts.length > 0) {
      sourceHistory[sourceId].avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    }
  }
  
  return sourceHistory;
}

/**
 * 生成每日反馈摘要
 * @param {Object} monitorResult - 监控结果
 * @param {Object} stats - 数据源统计
 * @returns {Object} 反馈记录对象
 */
function createDailyFeedback(monitorResult, stats = {}) {
  const report = monitorResult.report || {};
  const summary = report.summary || {};
  
  return {
    date: monitorResult.date || new Date().toISOString().split('T')[0],
    totalItems: summary.total || 0,
    highRiskCount: (summary.riskLevels || {}).high || 0,
    userFeedback: '',
    optimizationNotes: '',
    stats: {
      platforms: summary.platforms || {},
      riskLevels: summary.riskLevels || {},
      sentiments: summary.sentiments || {},
      sources: stats,
    },
  };
}

/**
 * 打印反馈摘要
 * @param {Object} feedback - 反馈数据
 */
function printFeedbackSummary(feedback) {
  if (!feedback || !feedback.records || feedback.records.length === 0) {
    console.log('[feedback] 暂无反馈记录');
    return;
  }
  
  console.log('\n📋 反馈记录摘要:');
  console.log('-'.repeat(50));
  console.log(`   总记录数: ${feedback.records.length}`);
  console.log(`   最后更新: ${feedback.metadata?.last_updated || '未知'}`);
  
  // 最近 7 天统计
  const recent = feedback.records.slice(0, 7);
  const totalItems = recent.reduce((sum, r) => sum + (r.totalItems || 0), 0);
  const totalHighRisk = recent.reduce((sum, r) => sum + (r.highRiskCount || 0), 0);
  
  console.log(`\n   最近 ${recent.length} 天统计:`);
  console.log(`   - 总条目: ${totalItems}`);
  console.log(`   - 高风险: ${totalHighRisk}`);
  console.log('-'.repeat(50));
}

module.exports = {
  FEEDBACK_FILE,
  loadFeedback,
  saveFeedback,
  getFeedbackInRange,
  getRecentFeedback,
  getSourceHealthHistory,
  createDailyFeedback,
  printFeedbackSummary,
};