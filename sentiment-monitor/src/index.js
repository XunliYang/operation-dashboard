/**
 * index.js - 舆情监控系统入口
 */

try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const report = require('./report');
const fetcher = require('./fetcher');
const agentReachFetcher = require('./agent-reach-fetcher');
const storage = require('./storage');
const feedback = require('./feedback');
const mailer = require('./mailer');
const firecrawlEnricher = require('./firecrawl-enricher');
const healthCheck = require('./health-check');
const ddgSearch = require('./ddg-search');
const timeExtractor = require('./timeExtractor');
const path = require('path');
const configLoader = require('./configLoader');
const fs = require('fs');

/**
 * 将 fetcher/agent-reach 的 stats key 映射为统一 source key
 */
const STATS_KEY_MAP = {
  'googleNews': 'google-news',
  'bingNews': 'bing-news',
  'githubRepos': 'github',
  'githubIssues': 'github',
  // 以下 key 本身已是统一名，无需映射
  // rss, exa, xiaohongshu, bilibili, weibo, v2ex, baidu
};

/**
 * 将单源 { success, count } 累积到 target 对象（同一 sourceKey 合并计数）
 */
function accumulateStats(target, rawStats) {
  for (const [rawKey, stat] of Object.entries(rawStats)) {
    const sourceKey = STATS_KEY_MAP[rawKey] || rawKey;
    if (!target[sourceKey]) {
      target[sourceKey] = { success: !!stat.success, count: stat.count || 0 };
    } else {
      target[sourceKey].count += stat.count || 0;
      target[sourceKey].success = target[sourceKey].success || !!stat.success;
    }
  }
}

/**
 * 将累积的 { success, count } 转为持久化格式 { status, count }
 */
function toSourceStatsFormat(accumulated) {
  const result = {};
  for (const [key, stat] of Object.entries(accumulated)) {
    result[key] = {
      status: stat.success ? 'success' : 'fail',
      count: stat.count,
    };
  }
  return result;
}

/**
 * 按采集方法分组构建统计数据
 * @param {Array} allItems - 所有采集的条目（含 source_method 和 source_detail）
 * @param {Object} fetcherStats - fetcher 原始统计
 * @param {Object} agentReachStats - agent-reach 原始统计
 * @returns {Object} 新格式: { methods: { rss: {...}, agent_reach: {...}, web_search: {...} }, summary: {...} }
 */
function buildMethodStats(allItems, fetcherStats, agentReachStats) {
  const FETCHER_METHOD_MAP = {
    'googleNews': 'rss',
    'bingNews': 'rss',
    'githubRepos': 'agent_reach',
    'githubIssues': 'agent_reach',
  };

  const AGENT_REACH_METHOD_MAP = {
    'exa': 'agent_reach',
    'xiaohongshu': 'agent_reach',
    'bilibili': 'agent_reach',
    'weibo': 'agent_reach',
    'v2ex': 'agent_reach',
    'baidu': 'agent_reach',
    'linkedin': 'agent_reach',
    'google-news': 'agent_reach',
  };

  const FETCHER_SOURCE_NAMES = {
    'googleNews': 'google-news',
    'bingNews': 'bing-news',
    'githubRepos': 'github',
    'githubIssues': 'github',
  };

  const methods = {
    rss: { total: 0, sources: {} },
    agent_reach: { total: 0, sources: {} },
    web_search: { total: 0, sources: {} },
  };

  for (const item of allItems) {
    const method = item.source_method || 'rss';
    const detail = item.source_detail || item.platform || 'unknown';

    if (!methods[method]) {
      methods[method] = { total: 0, sources: {} };
    }

    if (!methods[method].sources[detail]) {
      methods[method].sources[detail] = { status: 'success', count: 0 };
    }
    methods[method].sources[detail].count++;
  }

  for (const [rawKey, stat] of Object.entries(fetcherStats)) {
    if (rawKey === 'rss') {
      const hasPerFeedSources = Object.keys(methods.rss.sources).some(k => k.startsWith('rss:'));
      if (hasPerFeedSources) {continue;}
      if (!methods.rss.sources['rss:feeds']) {
        methods.rss.sources['rss:feeds'] = {
          status: stat.success ? 'success' : 'fail',
          count: 0,
        };
      }
      continue;
    }

    const method = FETCHER_METHOD_MAP[rawKey] || 'rss';
    const sourceName = FETCHER_SOURCE_NAMES[rawKey] || STATS_KEY_MAP[rawKey] || rawKey;

    if (!methods[method]) {
      methods[method] = { total: 0, sources: {} };
    }

    if (!methods[method].sources[sourceName]) {
      methods[method].sources[sourceName] = {
        status: stat.success ? 'success' : 'fail',
        count: 0,
      };
    } else if (!stat.success) {
      methods[method].sources[sourceName].status = 'fail';
    }
  }

  for (const [rawKey, stat] of Object.entries(agentReachStats)) {
    const method = AGENT_REACH_METHOD_MAP[rawKey] || 'agent_reach';
    const sourceName = STATS_KEY_MAP[rawKey] || rawKey;

    if (!methods[method]) {
      methods[method] = { total: 0, sources: {} };
    }

    if (!methods[method].sources[sourceName]) {
      methods[method].sources[sourceName] = {
        status: stat.success ? 'success' : 'fail',
        count: 0,
      };
    } else if (!stat.success) {
      methods[method].sources[sourceName].status = 'fail';
    }
  }

  for (const method of Object.keys(methods)) {
    let total = 0;
    for (const source of Object.values(methods[method].sources)) {
      total += source.count;
    }
    methods[method].total = total;
  }

  const methodsSummary = {};
  let totalSources = 0;
  let totalItems = 0;
  for (const [method, data] of Object.entries(methods)) {
    methodsSummary[method] = data.total;
    totalSources += Object.keys(data.sources).length;
    totalItems += data.total;
  }

  return {
    date: getCurrentDate(),
    methods,
    summary: {
      total_sources: totalSources,
      total_items: totalItems,
      methods_summary: methodsSummary,
    },
  };
}

function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

function loadConfig() {
  return configLoader.loadConfig();
}

/**
 * 生成 PDF 报告
 */
async function generatePDF(date) {
  try {
    const { execSync } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate-pdf.js');
    execSync(`node ${scriptPath} ${date}`, { stdio: 'inherit' });
    const proj = configLoader.getProjectConfig();
    const pdfPath = path.join(__dirname, '..', 'pdf', configLoader.renderTemplate(proj.pdfFilename, { name: proj.name, date }));
    return fs.existsSync(pdfPath) ? pdfPath : null;
  } catch (err) {
    console.warn('[monitor] PDF 生成失败:', err.message);
    return null;
  }
}

async function runDailyMonitor(referenceDate) {
  const date = referenceDate || getCurrentDate();
  console.log(`\n🔍 舆情监控开始 - ${date}`);

  const config = loadConfig();
  const keywords = configLoader.getKeywords();
  const kwConfig = configLoader.getKeywordConfig();

  console.log(`   关键词配置:`);
  keywords.forEach(kw => {
    const rssCount = configLoader.getRssSources(kw).length;
    console.log(`     ${kw}: 近${kwConfig.daysBack}日 | RSS源${rssCount}个`);
  });
  console.log('--------------------------------------------------');

  const allItems = [];
  const allFetcherStats = {};
  const allAgentReachStats = {};
  // 统一源统计（跨关键词累积）
  const allSourceStats = {};

  for (const keyword of keywords) {
    console.log(`\n📌 关键词: ${keyword} (近${kwConfig.daysBack}日)`);

    try {
      // Agent Reach 采集
      console.log('\n📡 开始 agent-reach 数据采集...');
      console.log('--------------------------------------------------');
      const agentReachResult = await agentReachFetcher.fetchAllAgentReach(keyword);
      
      console.log('\n📊 agent-reach 数据源采集状态:');
      for (const [key, stat] of Object.entries(agentReachResult.stats)) {
        const icon = stat.success ? '✅' : '❌';
        console.log(`   ${key.padEnd(12)}: ${icon} ${stat.count} 条`);
      }
      console.log(`\n   合计: ${agentReachResult.items.length} 条去重后结果`);
      console.log('--------------------------------------------------');

      // Feed/RSS 采集
      console.log('\n📡 开始数据采集...');
      console.log('--------------------------------------------------');
      const rssSources = configLoader.getRssSources(keyword);
      const feedResult = await fetcher.fetchAll({ rssSources, keyword });

      console.log('\n📊 数据源采集状态:');
      for (const [key, stat] of Object.entries(feedResult.stats)) {
        const icon = stat.success ? '✅' : '❌';
        console.log(`   ${key.padEnd(12)}: ${icon} ${stat.count} 条`);
      }
      console.log(`\n   合计: ${feedResult.items.length} 条去重后结果`);
      console.log('--------------------------------------------------');

      // 合并结果（RSS fetcher 优先，因为它有准确的 pubDate）
      const items = [...feedResult.items, ...agentReachResult.items];
      const seenUrls = new Set();
      const merged = [];
      for (const item of items) {
        if (item.url && seenUrls.has(item.url)) {continue;}
        if (item.url) {seenUrls.add(item.url);}
        merged.push({ ...item, keyword });
      }

      // 过滤：近 N 日 + 关键词精确匹配
      const daysBack = kwConfig.daysBack || 1;
      const todayOnly = kwConfig.todayOnly || false;
      const filtered = report.filterItems(merged, keyword, daysBack, { todayOnly, referenceDate: date });

      // 分析风险等级和情感
      const analyzed = report.updateRiskLevels(filtered);
      analyzed.forEach(item => {
        item.summary = report.generateSummary(item);
      });

      allItems.push(...analyzed);

      // 累积 stats（跨关键词求和）
      accumulateStats(allFetcherStats, feedResult.stats);
      accumulateStats(allAgentReachStats, agentReachResult.stats);
      accumulateStats(allSourceStats, feedResult.stats);
      accumulateStats(allSourceStats, agentReachResult.stats);

    } catch (err) {
      console.error(`[monitor][${keyword}] 采集失败:`, err.message);
    }
  }

  // 保存数据
  const savedData = storage.saveResults(date, allItems, keywords.join(', '));
  console.log(`[storage] 已保存 ${allItems.length} 条记录到 ${savedData.filepath}`);

  // 持久化采集源状态（新格式：按 method 分组）
  const methodStats = buildMethodStats(allItems, allFetcherStats, allAgentReachStats);
  storage.saveSourceStats(date, methodStats);
  
  // 同时保存旧格式（向后兼容 report.js）
  const sourceStatsSources = toSourceStatsFormat(allSourceStats);
  const sourceStatsData = { date, sources: sourceStatsSources, methods: methodStats };

  // 构建数据源健康度数据（用于健康度监控）
  const sourceHealth = healthCheck.buildSourceHealth(allFetcherStats, allAgentReachStats);

  // 执行健康度检查（自动检测数据源异常）
  try {
    healthCheck.runHealthCheck(sourceHealth);
  } catch (err) {
    console.warn('[monitor] 健康度检查失败:', err.message);
  }

  // 生成报告
  const dailyReport = report.generateDailyReport(savedData, sourceStatsData);
  report.printReport(dailyReport);

  // 保存反馈（包含 sourceHealth 数据）
  try {
    const fbEntry = feedback.createDailyFeedback(
      { date, report: dailyReport, success: true },
      { ...allFetcherStats, ...allAgentReachStats },
    );
    fbEntry.sourceHealth = sourceHealth;
    feedback.saveFeedback(fbEntry);
    console.log('[monitor] 反馈已保存');
    feedback.printFeedbackSummary(feedback.loadFeedback());
  } catch (err) {
    console.warn('[monitor] 反馈保存失败:', err.message);
  }

  // 邮件发送已移到 send-email 命令，等 web_search 合并后再发送
  console.log('[monitor] 数据采集完成，请使用 send-email 命令发送邮件（web_search 合并后）');

  const result = {
    success: true,
    date,
    keywords,
    itemCount: allItems.length,
    dataFile: savedData.filepath,
    report: dailyReport,
    fetcherStats: allFetcherStats,
    agentReachStats: allAgentReachStats,
  };

  console.log('监控完成:', result);
  return result;
}

function logEmailConfig(emailConfig, isProduction) {
  if (isProduction) {
    console.log(`[send-email] 📨 正式模式，收件人: ${(emailConfig.productionTo || emailConfig.to).join(', ')}`);
    if (emailConfig.productionCc) {
      console.log(`[send-email] 📧 抄送: ${emailConfig.productionCc.join(', ')}`);
    }
  } else {
    console.log(`[send-email] 🧪 测试模式，收件人: ${emailConfig.to.join(', ')}`);
  }
}

/**
 * 运行站点补充搜索（内置 DuckDuckGo）
 * 替代外部 agent 的 web_search，直接搜索国内技术社区并合并到当天数据
 */
async function runSearchSites(referenceDate) {
  const date = referenceDate || getCurrentDate();
  console.log(`\n🔍 站点补充搜索开始 - ${date}`);

  const config = loadConfig();
  const keywords = configLoader.getKeywords();
  
  const allItems = [];
  
  for (const keyword of keywords) {
    console.log(`\n📌 关键词: ${keyword}`);
    
    try {
      // 使用内置 DuckDuckGo 搜索
      const searchResults = await ddgSearch.searchAllSites(keyword);
      
      // 标记关键词
      searchResults.forEach(item => {
        item.keyword = keyword;
      });
      
      allItems.push(...searchResults);
    } catch (err) {
      console.error(`[search-sites][${keyword}] 搜索失败:`, err.message);
    }
  }
  
  if (allItems.length === 0) {
    console.log('[search-sites] 未获取到任何结果');
    return { success: true, date, itemCount: 0 };
  }
  
  // 使用 timeExtractor 统一提取时间（对需要时间提取的条目）
  console.log(`\n[search-sites] 开始时间提取（${allItems.length} 条）...`);
  const enrichedItems = [];
  
  for (const item of allItems) {
    if (item._needsTimeExtraction) {
      const result = await timeExtractor.extract({
        item,
        fallbackDate: date,
        url: item.url,
      });
      item.timestamp = result.timestamp;
      item._timeEstimated = result.estimated;
      item._timeMethod = result.method;
    }
    enrichedItems.push(item);
  }
  
  const estimatedCount = enrichedItems.filter(i => i._timeEstimated).length;
  console.log(`[search-sites] 时间提取完成: ${estimatedCount}/${enrichedItems.length} 条使用兜底时间`);
  
  // 合并到当天数据
  const result = storage.mergeWebSearch(date, enrichedItems);
  console.log(`✅ 已合并 ${enrichedItems.length} 条搜索结果到 ${date}`);
  
  return { success: true, date, itemCount: enrichedItems.length };
}

// 命令行入口
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // 解析 --profile 参数
  const profileIndex = args.findIndex(a => a === '--profile' || a.startsWith('--profile='));
  if (profileIndex !== -1) {
    let profile;
    if (args[profileIndex].includes('=')) {
      profile = args[profileIndex].split('=')[1];
    } else {
      profile = args[profileIndex + 1];
    }
    if (profile) {
      configLoader.setProfile(profile);
      // 从 args 中移除 --profile 相关参数
      args.splice(profileIndex, profile.startsWith('--profile=') ? 1 : 2);
    }
  }
  
  const command = args[0];

  if (command === 'monitor' || !command) {
    const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
    runDailyMonitor(date)
      .then(result => process.exit(0))
      .catch(err => {
        console.error('监控失败:', err);
        process.exit(1);
      });
  } else if (command === 'report') {
    const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || getCurrentDate();
    const data = storage.loadResults(date);
    const sourceStats = storage.loadSourceStats(date);
    if (data) {
      const dailyReport = report.generateDailyReport(data, sourceStats);
      report.printReport(dailyReport);
    } else {
      console.log(`未找到 ${date} 的数据`);
    }
  } else if (command === 'websearch') {
    const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || getCurrentDate();
    let input = '';
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      input += chunk;
    });
    
    process.stdin.on('end', async () => {
      try {
        const items = JSON.parse(input);
        if (!Array.isArray(items)) {
          console.error('❌ 错误: stdin 内容不是 JSON 数组');
          process.exit(1);
        }
        
        // 使用 Firecrawl 提取真实发布时间（替换占位符时间）
        const enrichedItems = await firecrawlEnricher.enrichWithFirecrawl(items, date);
        console.log(`[websearch] Firecrawl 时间提取完成: ${enrichedItems.filter(i => i._enriched_by === 'firecrawl').length}/${items.length} 条已补充真实时间`);
        
        const result = storage.mergeWebSearch(date, enrichedItems);
        (Promise.resolve(result)).then(() => {
          console.log(`✅ 已合并 ${items.length} 条 web_search 结果到 ${date}`);
          process.exit(0);
        }).catch(err => {
          console.error('❌ 合并失败:', err.message);
          process.exit(1);
        });
      } catch (err) {
        console.error('❌ 解析 stdin JSON 失败:', err.message);
        process.exit(1);
      }
    });
    
    process.stdin.on('error', err => {
      console.error('❌ stdin 读取错误:', err.message);
      process.exit(1);
    });
  } else if (command === 'search-sites') {
    const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
    runSearchSites(date)
      .then(result => {
        console.log('[search-sites] 完成:', result);
        process.exit(0);
      })
      .catch(err => {
        console.error('[search-sites] 失败:', err);
        process.exit(1);
      });
  } else if (command === 'send-email') {
    const isProduction = args.includes('--production');
    const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || getCurrentDate();
    const data = storage.loadResults(date);
    const sourceStats = storage.loadSourceStats(date);
    if (!data) {
      console.error(`❌ 未找到 ${date} 的数据`);
      process.exit(1);
    }
    const dailyReport = report.generateDailyReport(data, sourceStats);
    // 发送邮件
    const config = loadConfig();
    if (config.email?.enabled) {
      const emailConfig = { ...config.email };
      logEmailConfig(emailConfig, isProduction);
      mailer.sendReport(date, dailyReport, { email: emailConfig }, null, isProduction)
        .then(() => {
          console.log(`[send-email] HTML 模板邮件发送成功${isProduction ? ' (正式)' : ' (测试)'}`);
          process.exit(0);
        })
        .catch(err => {
          console.error('[send-email] 邮件发送失败:', err.message);
          process.exit(1);
        });
    } else {
      console.log('[send-email] 邮件未启用 (config.email.enabled = false)');
      process.exit(0);
    }
  } else {
    const profile = configLoader.getProfile();
    console.log('用法: node src/index.js [command] [date] [--profile <name>]');
    console.log('');
    console.log('命令:');
    console.log('  monitor       多源数据采集（RSS/API/CLI，不发送邮件）');
    console.log('  search-sites  内置 DuckDuckGo 搜索国内技术社区（CSDN/知乎/掘金等）');
    console.log('  report        生成并打印报告');
    console.log('  websearch     [可选] 从 stdin 读取外部搜索结果并合并');
    console.log('  send-email    基于最新数据生成 HTML 邮件并发送');
    console.log('');
    console.log('选项:');
    console.log('  --profile <name>  使用 config/<name>.json 配置文件');
    console.log('  --production      send-email 命令专用，发送到正式收件人列表');
    console.log('');
    console.log('推荐流程（Agent Skill: daily-monitor）:');
    console.log('  1. node src/index.js monitor --profile <name>');
    console.log('  2. node src/index.js search-sites --profile <name>');
    console.log('  3. node src/index.js send-email --profile <name> --production');
    console.log('');
    console.log('示例:');
    console.log('  node src/index.js monitor --profile openan');
    console.log('  node src/index.js search-sites --profile openan');
    console.log('  node src/index.js send-email --profile openan --production');
    if (profile) {
      console.log(`\n当前 profile: ${profile}`);
    }
  }
}

module.exports = { runDailyMonitor, generatePDF };
