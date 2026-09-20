/**
 * health-check.js - 数据源健康度监控模块
 * 检测数据源异常，写入日志，人工确认
 */

const fs = require('fs');
const path = require('path');
const feedback = require('./feedback');

const HEALTH_LOG_PATH = path.join(__dirname, '..', 'data', 'health.log');

// 异常阈值：低于历史均值的百分比
const ANOMALY_THRESHOLD = 0.5;

// 历史窗口天数
const HISTORY_WINDOW_DAYS = 7;

/**
 * 确保数据目录存在
 */
function ensureDataDir() {
  const dataDir = path.dirname(HEALTH_LOG_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * 写入健康度日志
 * @param {string} message - 日志消息
 */
function writeHealthLog(message) {
  ensureDataDir();
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(HEALTH_LOG_PATH, logLine, 'utf-8');
}

/**
 * 检查单个数据源的健康状态
 * @param {string} sourceId - 数据源 ID
 * @param {number} rawCount - 今天的原始数据量（过滤前）
 * @param {number} avgCount - 历史平均值
 * @returns {Object} { status: 'normal'|'anomaly', message: string }
 */
function checkSourceHealth(sourceId, rawCount, avgCount) {
  // 无历史数据时基线为 0，首次运行不告警
  if (avgCount === 0) {
    return {
      status: 'normal',
      message: `[health] ${sourceId}: 首次运行，无历史数据，跳过检查`,
    };
  }
  
  const threshold = avgCount * ANOMALY_THRESHOLD;
  
  if (rawCount < threshold) {
    const dropPercent = ((avgCount - rawCount) / avgCount * 100).toFixed(1);
    return {
      status: 'anomaly',
      message: `[health] ⚠️ ${sourceId}: 异常! 今天 ${rawCount} 条，7天均值 ${avgCount.toFixed(1)} 条，下降 ${dropPercent}%`,
    };
  }
  
  return {
    status: 'normal',
    message: `[health] ✓ ${sourceId}: 正常 (今天 ${rawCount} 条，均值 ${avgCount.toFixed(1)} 条)`,
  };
}

/**
 * 执行健康度检查
 * @param {Object} sourceHealth - 今天的数据源健康度 { sourceId: { rawCount, filteredCount } }
 * @returns {Object} { anomalies: string[], summary: string }
 */
function runHealthCheck(sourceHealth) {
  if (!sourceHealth || Object.keys(sourceHealth).length === 0) {
    return {
      anomalies: [],
      summary: '[health] 无数据源健康度数据，跳过检查',
    };
  }
  
  // 获取历史健康度数据
  const history = feedback.getSourceHealthHistory(HISTORY_WINDOW_DAYS);
  
  const anomalies = [];
  const messages = [];
  
  messages.push(`\n[health] ========== 数据源健康度检查 ==========`);
  messages.push(`[health] 检查时间: ${new Date().toISOString()}`);
  messages.push(`[health] 历史窗口: ${HISTORY_WINDOW_DAYS} 天`);
  messages.push(`[health] 异常阈值: 低于均值 ${ANOMALY_THRESHOLD * 100}%`);
  messages.push('');
  
  for (const [sourceId, health] of Object.entries(sourceHealth)) {
    const rawCount = health.rawCount || 0;
    const historyData = history[sourceId];
    const avgCount = historyData ? historyData.avg : 0;
    
    const result = checkSourceHealth(sourceId, rawCount, avgCount);
    messages.push(result.message);
    
    if (result.status === 'anomaly') {
      anomalies.push(result.message);
      writeHealthLog(result.message);
    }
  }
  
  messages.push('');
  if (anomalies.length === 0) {
    messages.push('[health] ✓ 所有数据源健康度正常');
  } else {
    messages.push(`[health] ⚠️ 发现 ${anomalies.length} 个异常数据源，请查看 ${HEALTH_LOG_PATH}`);
  }
  messages.push('');
  
  const summary = messages.join('\n');
  console.log(summary);
  
  return { anomalies, summary };
}

/**
 * 构建数据源健康度数据
 * 在采集阶段调用，记录每个源的 rawCount
 * @param {Object} fetcherStats - fetcher 统计 { sourceId: { success, count } }
 * @param {Object} agentReachStats - agent-reach 统计 { sourceId: { success, count } }
 * @returns {Object} { sourceId: { rawCount, filteredCount } }
 */
function buildSourceHealth(fetcherStats, agentReachStats) {
  const sourceHealth = {};
  
  // 映射 fetcher stats key 到统一 source key
  const STATS_KEY_MAP = {
    'googleNews': 'google-news',
    'bingNews': 'bing-news',
    'githubRepos': 'github',
    'githubIssues': 'github',
  };
  
  // 处理 fetcher stats
  for (const [rawKey, stat] of Object.entries(fetcherStats || {})) {
    const sourceId = STATS_KEY_MAP[rawKey] || rawKey;
    if (!sourceHealth[sourceId]) {
      sourceHealth[sourceId] = { rawCount: 0, filteredCount: 0 };
    }
    sourceHealth[sourceId].rawCount += stat.count || 0;
  }
  
  // 处理 agent-reach stats
  for (const [rawKey, stat] of Object.entries(agentReachStats || {})) {
    const sourceId = STATS_KEY_MAP[rawKey] || rawKey;
    if (!sourceHealth[sourceId]) {
      sourceHealth[sourceId] = { rawCount: 0, filteredCount: 0 };
    }
    sourceHealth[sourceId].rawCount += stat.count || 0;
  }
  
  return sourceHealth;
}

module.exports = {
  runHealthCheck,
  buildSourceHealth,
  writeHealthLog,
  HEALTH_LOG_PATH,
  ANOMALY_THRESHOLD,
  HISTORY_WINDOW_DAYS,
};
