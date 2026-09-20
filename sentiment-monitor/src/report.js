/**
 * report.js - 舆情报告生成模块
 * 负责统计各平台数量、情感分析、风险标记
 */
const configLoader = require('./configLoader');

// 平台分类（按用户指定顺序）
const PLATFORM_CATEGORIES = [
  { key: 'csdn', label: 'CSDN' },
  { key: 'segmentfault', label: '思否' },
  { key: 'juejin', label: '掘金' },
  { key: 'cnblogs', label: '博客园' },
  { key: 'maimai', label: '脉脉' },
  { key: 'v2ex', label: 'V2EX' },
  { key: 'zhihu', label: '知乎' },
  { key: 'weixin', label: '微信公众号' },
  { key: 'bilibili', label: 'B站' },
  { key: 'weibo', label: '微博' },
  { key: 'xiaohongshu', label: '小红书' },
  { key: 'zsxq', label: '知识星球' },
  { key: 'qq', label: 'QQ群/微信群' },
  { key: 'gitee', label: 'Gitee' },
  { key: 'gitcode', label: 'GitCode' },
  { key: 'github', label: 'GitHub' },
  { key: 'oschina', label: '开源中国OSChina' },
  { key: 'hellogithub', label: 'HelloGithub' },
  { key: 'baidu', label: '百度' },
  { key: 'toutiao', label: '头条' },
  { key: 'infoq', label: 'InfoQ' },
  { key: 'douyin', label: '抖音' },
  { key: 'linkedin', label: 'LinkedIn' },
  // 通用/其他
  { key: 'google-news', label: 'Google News' },
  { key: 'bing-news', label: 'Bing News' },
  { key: 'rss', label: 'RSS源' },
  { key: 'search-rss', label: '搜索RSS' },
  { key: 'feed-rss', label: '信息流RSS' },
  { key: 'exa', label: 'Exa搜索' },
  { key: 'news', label: 'News' },
  { key: 'twitter', label: 'Twitter' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'other', label: '其他' },
];

// 风险关键词定义
const RISK_KEYWORDS = {
  high: [
    '安全漏洞', 'security breach', '数据泄露', 'data leak',
    '攻击', 'attack', '恶意', 'malicious', '漏洞', 'vulnerability',
    '诉讼', 'lawsuit', '违规', 'violation', '封禁', 'ban',
  ],
  medium: [
    '竞争', 'competitor', '质疑', 'question', '争议', 'controversy',
    '负面', 'negative', '批评', 'criticism', '风险', 'risk',
    '警告', 'warning', '问题', 'problem', 'issue',
  ],
  low: [
    '新功能', 'new feature', '发布', 'release', '更新', 'update',
    '合作', 'partnership', '融资', 'funding', '增长', 'growth',
  ],
};

// 情感关键词定义
const SENTIMENT_KEYWORDS = {
  positive: [
    '创新', 'innovation', '突破', 'breakthrough', '优秀', 'excellent',
    '领先', 'leading', '成功', 'success', '合作', 'partnership',
    '增长', 'growth', '发布', 'release', '利好', 'positive',
  ],
  negative: [
    '失败', 'failure', '问题', 'problem', '风险', 'risk',
    '下降', 'decline', '裁员', 'layoff', '关闭', 'shutdown',
    '负面', 'negative', '批评', 'criticism', '争议', 'controversy',
  ],
};

// 源显示名称映射（用于新格式报告）
const SOURCE_DISPLAY_NAMES = {
  'weibo': '微博',
  'github': 'GitHub',
  'google-news': 'Google News',
  'bing-news': 'Bing News',
  'bilibili': 'B站',
  'v2ex': 'V2EX',
  'xiaohongshu': '小红书',
  'baidu': '百度',
  'exa': 'Exa搜索',
  'rss': 'RSS',
  'search-rss': '搜索RSS',
  'feed-rss': '信息流RSS',
  'news': 'News',
  'other': '其他',
};

// 源显示顺序（用于新格式报告）
const SOURCE_DISPLAY_ORDER = [
  'weibo', 'github', 'google-news', 'bing-news', 'bilibili',
  'v2ex', 'exa', 'xiaohongshu', 'baidu', 'rss', 'search-rss', 'feed-rss',
];

// 平台到源的映射（用于将 items 按源分组）
const PLATFORM_TO_SOURCE = {
  'search-rss': 'rss',
  'feed-rss': 'rss',
  // 其他平台名与源名一致，无需映射
};

/**
 * 评估风险等级
 * @param {string} text - 文本内容(标题 + 摘要)
 * @returns {string} 风险等级
 */
function assessRisk(text) {
  const textLower = (text || '').toLowerCase();

  // 检查高风险关键词
  for (const keyword of RISK_KEYWORDS.high) {
    if (textLower.includes(keyword.toLowerCase())) {
      return 'high';
    }
  }

  // 检查中风险关键词
  for (const keyword of RISK_KEYWORDS.medium) {
    if (textLower.includes(keyword.toLowerCase())) {
      return 'medium';
    }
  }

  return 'low';
}

/**
 * 分析情感倾向
 * @param {string} text - 文本内容
 * @returns {string} 情感倾向 (positive/negative/neutral)
 */
function analyzeSentiment(text) {
  const textLower = (text || '').toLowerCase();

  let positiveScore = 0;
  let negativeScore = 0;

  for (const keyword of SENTIMENT_KEYWORDS.positive) {
    if (textLower.includes(keyword.toLowerCase())) {
      positiveScore++;
    }
  }

  for (const keyword of SENTIMENT_KEYWORDS.negative) {
    if (textLower.includes(keyword.toLowerCase())) {
      negativeScore++;
    }
  }

  if (positiveScore > negativeScore) {return 'positive';}
  if (negativeScore > positiveScore) {return 'negative';}
  return 'neutral';
}

/**
 * 更新数据项的风险等级
 * @param {Array} items - 数据项数组
 * @returns {Array} 更新后的数组
 */
function updateRiskLevels(items) {
  for (const item of items) {
    const textToAnalyze = `${item.title} ${item.snippet}`;
    item.risk_level = assessRisk(textToAnalyze);
    item.sentiment = analyzeSentiment(textToAnalyze);
  }

  return items;
}

/**
 * 生成内容摘要(参考掘金文章 AI 摘要思路,规则引擎实现)
 * @param {Object} item - 数据项
 * @returns {string} 摘要文本
 */
function generateSummary(item) {
  if (!item) {return '';}

  const title = item.title || '';
  const snippet = item.snippet || '';
  const platform = item.platform || '';

  // 已经有足够长的摘要
  if (snippet && snippet.length > 20) {
    // 截断到 150 字,保持简洁
    return snippet.length > 150 ? `${snippet.substring(0, 150)  }...` : snippet;
  }

  // GitHub 项目:用 description 生成摘要
  if (platform === 'github' || platform === 'github-repos') {
    if (title.includes(':') && !title.startsWith('#')) {
      const parts = title.split(':');
      return parts[1].trim() || parts[0].trim();
    }
    return title;
  }

  // GitHub Issue/PR
  if (title.startsWith('feat:') || title.startsWith('fix:') || title.startsWith('chore:')) {
    return title.replace(/^(feat|fix|chore|docs|refactor|style|test):\s*/, '');
  }

  // 默认用标题
  return title;
}

/**
 * 评分:按相关性和重要性排序
 * @param {Array} items - 数据项数组
 * @param {string} keyword - 关键词
 * @returns {Array} 排序后的数组
 */
function scoreAndRank(items, keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const effectiveKw = keyword || defaultKw;
  const kw = effectiveKw.toLowerCase();

  return items.map(item => {
    let score = 0;
    const text = `${item.title} ${item.snippet}`.toLowerCase();

    // 风险项加分
    if (item.risk_level === 'high') {score += 30;}
    else if (item.risk_level === 'medium') {score += 15;}

    // 平台权重(新闻 > 社交)
    if (item.platform === 'github') {score += 10;}
    else if (item.platform === 'google-news' || item.platform === 'bing-news') {score += 15;}
    else if (item.platform === 'exa') {score += 20;}

    // 时间新鲜度加分
    if (item.timestamp) {
      const hoursAgo = (Date.now() - new Date(item.timestamp).getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 24) {score += 10;}
      else if (hoursAgo < 48) {score += 5;}
    }

    // 摘要长度(有详细摘要的加分)
    if (item.snippet && item.snippet.length > 50) {score += 5;}

    item.relevanceScore = score;
    return item;
  }).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
}


// 搜索型平台：这些工具本身按关键词搜索，返回结果已经相关，跳过关键词过滤
const SEARCH_TYPE_PLATFORMS = ['weibo', 'v2ex', 'xiaohongshu', 'baidu', 'exa', 'web-search', 'google-news'];

/**
 * 过滤数据：近 N 日 + 关键词匹配
 * 搜索型平台（weibo/bilibili/v2ex/xiaohongshu/baidu/exa/web-search）跳过关键词过滤，
 * 因为这些工具本身就是按关键词搜索的，返回的结果已经相关
 * @param {Array} items - 数据项数组
 * @param {string} keyword - 关键词
 * @param {number} daysBack - 回溯天数
 * @param {Object} [options] - 选项
 * @param {boolean} [options.todayOnly] - 仅保留当天数据（UTC 0点起）
 * @returns {Array} 过滤后的数据
 */
function filterItems(items, keyword, daysBack, options = {}) {
  const todayOnly = options.todayOnly || false;
  const referenceDate = options.referenceDate || null;
  let lowerBound;
  let upperBound;
  let cutoff;

  if (todayOnly) {
    // 使用 UTC+8 (北京时间) 作为基线
    const refDate = referenceDate || new Date().toISOString().split('T')[0];
    // 北京时间午夜 = UTC 前一天 16:00
    lowerBound = new Date(`${refDate  }T00:00:00+08:00`).getTime();
    upperBound = new Date(`${refDate  }T23:59:59.999+08:00`).getTime();
    cutoff = lowerBound;
  } else {
    const refTime = referenceDate ? new Date(`${referenceDate  }T23:59:59+08:00`).getTime() : Date.now();
    cutoff = refTime - daysBack * 24 * 60 * 60 * 1000;
    upperBound = Infinity;
  }

  return items.filter(item => {
    // 时间过滤
    if (item.timestamp) {
      const t = new Date(item.timestamp).getTime();
      // 无法解析的时间戳在 todayOnly 模式下应该被过滤
      if (isNaN(t)) {
        if (todayOnly) {return false;}
      } else if (todayOnly) {
        // todayOnly 模式：需要在指定日期的范围内（下限+上限）
        if (t < lowerBound || t > upperBound) {return false;}
      } else if (t < cutoff) {
        return false;
      }
    } else if (todayOnly) {
      // 没有时间戳的在 todayOnly 模式下也应被过滤
      return false;
    }
    // 搜索型平台跳过关键词过滤（工具本身已按关键词搜索，结果已相关）
    if (SEARCH_TYPE_PLATFORMS.includes(item.platform)) {
      return true;
    }
    // 关键词匹配（标题/摘要/URL 任一命中即可）
    const kw = keyword.toLowerCase();
    const fields = [item.title, item.snippet, item.url, item.description].filter(Boolean).join(' ').toLowerCase();
    return fields.includes(kw);
  });
}

/**
 * 生成单日报告
 * @param {Object} data - 当日数据
 * @param {Object} [sourceStats] - 可选的采集源状态数据 { date, sources: {...} }
 * @returns {Object} 报告对象
 */
function generateDailyReport(data, sourceStats = null) {
  if (!data || !data.items || data.items.length === 0) {
    return {
      date: data?.date || new Date().toISOString().split('T')[0],
      summary: {
        total: 0,
        platforms: {},
        riskLevels: { high: 0, medium: 0, low: 0 },
        sentiments: { positive: 0, negative: 0, neutral: 0 },
      },
      highRiskItems: [],
      recommendations: ['无数据,建议检查数据采集'],
      sourceStats,
      sourceGrouped: {},
    };
  }

  // 加载配置并过滤数据（防御性过滤，确保报告只展示近期内容）
  const fs = require('fs');
  const path = require('path');
  let filteredItems = data.items;
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const keywords = configLoader.getKeywords();
    const daysBack = config.keywordConfig?.[keywords[0]]?.daysBack || 3;
    const referenceDate = data.date || new Date().toISOString().split('T')[0];
    
    // 只做时间过滤，不做关键词过滤（数据已按关键词存储）
    const refTime = new Date(`${referenceDate  }T23:59:59+08:00`).getTime();
    const cutoff = refTime - daysBack * 24 * 60 * 60 * 1000;
    filteredItems = data.items.filter(item => {
      if (item.timestamp) {
        const t = new Date(item.timestamp).getTime();
        if (!isNaN(t) && t < cutoff) {return false;}
      }
      return true;
    });
    
    if (filteredItems.length < data.items.length) {
      console.log(`[generateDailyReport] 过滤旧内容: ${data.items.length} → ${filteredItems.length} 条（>${daysBack}天）`);
    }
  } catch (err) {
    console.warn(`[generateDailyReport] 加载配置失败，使用原始数据: ${err.message}`);
  }

  if (filteredItems.length === 0) {
    return {
      date: data.date || new Date().toISOString().split('T')[0],
      summary: {
        total: 0,
        platforms: {},
        riskLevels: { high: 0, medium: 0, low: 0 },
        sentiments: { positive: 0, negative: 0, neutral: 0 },
      },
      highRiskItems: [],
      recommendations: ['无符合条件的近期数据'],
      sourceStats,
      sourceGrouped: {},
    };
  }

  // 更新风险等级 + 生成摘要
  const items = updateRiskLevels(filteredItems);
  for (const item of items) {
    item.summary = generateSummary(item);
  }

  // 评分排序
  const scoredItems = scoreAndRank(items, data.keyword || configLoader.getKeywords()[0]);

  // 提取 Top 精选内容(前 10 条)
  const topItems = scoredItems.slice(0, 10);

  // 统计平台分布
  const platforms = {};
  for (const item of items) {
    const p = item.platform || 'other';
    platforms[p] = (platforms[p] || 0) + 1;
  }

  // 统计风险等级
  const riskLevels = { high: 0, medium: 0, low: 0 };
  for (const item of items) {
    riskLevels[item.risk_level] = (riskLevels[item.risk_level] || 0) + 1;
  }

  // 统计情感分布
  const sentiments = { positive: 0, negative: 0, neutral: 0 };
  for (const item of items) {
    sentiments[item.sentiment] = (sentiments[item.sentiment] || 0) + 1;
  }

  // 提取高风险内容
  const highRiskItems = items.filter(item => item.risk_level === 'high');

  // 生成建议
  const recommendations = generateRecommendations({
    platforms,
    riskLevels,
    sentiments,
    highRiskItems,
  });

  // 按分类分组（旧格式，保持向后兼容）
  const platformCategorized = {};
  for (const cat of PLATFORM_CATEGORIES) {
    platformCategorized[cat.key] = { label: cat.label, items: [], count: 0 };
  }
  // 未分类归入 other
  for (const item of items) {
    const p = item.platform || 'other';
    if (platformCategorized[p]) {
      platformCategorized[p].items.push(item);
      platformCategorized[p].count++;
    } else {
      platformCategorized.other.items.push(item);
      platformCategorized.other.count++;
    }
  }

  // 按源分组（新格式）
  const sourceGrouped = {};
  for (const item of items) {
    const platform = item.platform || 'other';
    const sourceKey = PLATFORM_TO_SOURCE[platform] || platform;
    if (!sourceGrouped[sourceKey]) {sourceGrouped[sourceKey] = [];}
    sourceGrouped[sourceKey].push(item);
  }

  return {
    date: data.date,
    keyword: data.keyword,
    summary: {
      total: items.length,
      platforms,
      riskLevels,
      sentiments,
    },
    platformCategorized,
    sourceGrouped,
    sourceStats,
    highRiskItems: highRiskItems.map(item => ({
      platform: item.platform,
      title: item.title,
      url: item.url,
      summary: item.summary || '',
      risk_level: item.risk_level,
      sentiment: item.sentiment,
      relevanceScore: item.relevanceScore || 0,
    })),
    topItems: topItems.map(item => ({
      platform: item.platform,
      title: item.title,
      url: item.url,
      summary: item.summary || '',
      timestamp: item.timestamp,
      risk_level: item.risk_level,
      sentiment: item.sentiment,
      relevanceScore: item.relevanceScore || 0,
    })),
    recommendations,
  };
}

/**
 * 生成建议
 * @param {Object} stats - 统计数据
 * @returns {Array} 建议列表
 */
function generateRecommendations(stats) {
  const recommendations = [];

  // 高风险内容建议
  if (stats.riskLevels.high > 0) {
    recommendations.push(`⚠️ 发现 ${stats.riskLevels.high} 条高风险内容,建议立即关注并制定应对策略`);
  }

  // 中风险内容建议
  if (stats.riskLevels.medium > 0) {
    recommendations.push(`📋 发现 ${stats.riskLevels.medium} 条中风险内容,建议持续监控`);
  }

  // 负面情感建议
  if (stats.sentiments.negative > stats.sentiments.positive) {
    recommendations.push('📉 负面情感内容占比偏高,建议关注舆论走向');
  }

  // 平台分布建议
  const [topPlatform] = Object.entries(stats.platforms)
    .sort((a, b) => b[1] - a[1]);

  if (topPlatform) {
    recommendations.push(`📊 主要讨论平台: ${topPlatform[0]} (${topPlatform[1]}条)`);
  }

  // 高风险内容详细建议
  if (stats.highRiskItems.length > 0) {
    const urls = stats.highRiskItems.slice(0, 3).map(i => i.url);
    recommendations.push(`🔍 高风险来源示例: ${urls.join(', ')}`);
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ 舆情整体平稳,继续保持监控');
  }

  return recommendations;
}

/**
 * 生成周期报告(多日汇总)
 * @param {Array} dailyReports - 多个日报告数组
 * @returns {Object} 周期报告
 */
function generatePeriodReport(dailyReports) {
  const totals = {
    totalItems: 0,
    platforms: {},
    riskLevels: { high: 0, medium: 0, low: 0 },
    sentiments: { positive: 0, negative: 0, neutral: 0 },
  };

  const allHighRiskItems = [];
  const trends = {};

  for (const report of dailyReports) {
    totals.totalItems += report.summary.total;

    // 合并平台统计
    for (const [platform, count] of Object.entries(report.summary.platforms)) {
      totals.platforms[platform] = (totals.platforms[platform] || 0) + count;
    }

    // 合并风险统计
    for (const [level, count] of Object.entries(report.summary.riskLevels)) {
      totals.riskLevels[level] += count;
    }

    // 合并情感统计
    for (const [sentiment, count] of Object.entries(report.summary.sentiments)) {
      totals.sentiments[sentiment] += count;
    }

    // 收集高风险内容
    allHighRiskItems.push(...report.highRiskItems);

    // 记录趋势
    trends[report.date] = report.summary.total;
  }

  return {
    period: {
      start: dailyReports[0]?.date,
      end: dailyReports[dailyReports.length - 1]?.date,
      days: dailyReports.length,
    },
    summary: totals,
    highRiskItems: allHighRiskItems.slice(0, 10), // 只保留前10条
    trends,
    recommendations: generateRecommendations({
      platforms: totals.platforms,
      riskLevels: totals.riskLevels,
      sentiments: totals.sentiments,
      highRiskItems: allHighRiskItems,
    }),
  };
}

/**
 * 格式化时间戳为 YYYY-MM-DD HH:MM (UTC+8)
 * @param {string} timestamp - ISO 时间戳
 * @returns {string} 格式化时间
 */
function formatTimestamp(timestamp) {
  if (!timestamp) {return '';}
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {return '';}
    // 转换为 UTC+8
    const utc8Time = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const yyyy = utc8Time.getUTCFullYear();
    const mm = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc8Time.getUTCDate()).padStart(2, '0');
    const hh = String(utc8Time.getUTCHours()).padStart(2, '0');
    const min = String(utc8Time.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return '';
  }
}

function buildItemMetaLines(item, timeStr) {
  const metaParts = [];
  if (timeStr) {metaParts.push(`⏰ ${timeStr}`);}
  if (item.summary) {metaParts.push(`📝 ${item.summary.substring(0, 120)}`);}
  if (metaParts.length === 0) {return [];}
  return [`       ${metaParts.join(' | ')}`];
}

/**
 * 按平台分类打印报告（旧格式，保持向后兼容）
 * @param {Object} report - 报告对象
 * @returns {string} 格式化文本
 */
function printPlatformCategorized(report) {
  const lines = [];
  lines.push(`\n${  '='.repeat(60)}`);
  const proj = configLoader.getProjectConfig();
  lines.push(`  ${proj.displayName} 舆情监控报告 - ${report.date}`);
  lines.push('='.repeat(60));

  lines.push('\n📊 总体统计:');
  lines.push(`   总计: ${report.summary.total} 条`);
  lines.push(`   高风险: ${report.summary.riskLevels.high} · 中风险: ${report.summary.riskLevels.medium} · 低风险: ${report.summary.riskLevels.low}`);
  lines.push(`   正面: ${report.summary.sentiments.positive} · 负面: ${report.summary.sentiments.negative} · 中性: ${report.summary.sentiments.neutral}`);

  lines.push('\n📋 平台分栏:');
  const cat = report.platformCategorized;
  if (!cat) {
    lines.push('   （无分类数据）');
  } else {
    for (const c of PLATFORM_CATEGORIES) {
      const info = cat[c.key];
      if (!info) {continue;}
      if (info.count === 0) {
        lines.push(`   ─ ${c.label}: 无`);
      } else {
        lines.push(`   ▼ ${c.label}: ${info.count}条`);
        for (const item of info.items) {
          const timeStr = formatTimestamp(item.timestamp);
          lines.push(`     • ${item.title}`);
          lines.push(...buildItemMetaLines(item, timeStr));
          lines.push(`       🔗 ${item.url}`);
        }
      }
    }
  }

  if (report.recommendations && report.recommendations.length > 0) {
    lines.push('\n💡 建议:');
    report.recommendations.forEach((rec, i) => {
      lines.push(`   ${i + 1}. ${rec}`);
    });
  }

  lines.push(`\n${  '='.repeat(60)  }\n`);
  return lines.join('\n');
}

/**
 * 生成每日总结（供 reviewer 使用，按平台分栏顺序说明）
 * @param {Object} report - 报告对象
 * @returns {string} 总结文本
 */
function generateDailySummary(report) {
  const lines = [];
  const proj2 = configLoader.getProjectConfig();
  lines.push(`📋 ${proj2.displayName} 舆情每日总结 — ${report.date}`);
  lines.push('');

  const cat = report.platformCategorized;
  if (!cat) {return '无数据';}

  let totalCount = 0;
  let hasResults = false;

  for (const c of PLATFORM_CATEGORIES) {
    const info = cat[c.key];
    if (!info || info.count === 0) {continue;}
    hasResults = true;
    lines.push(`**${c.label}** (${info.count}条)`);
    for (const item of info.items) {
      const timeStr = formatTimestamp(item.timestamp);
      lines.push(`- ${item.title}`);
      if (timeStr) {lines.push(`  ⏰ ${timeStr}`);}
      if (item.summary) {lines.push(`  摘要: ${item.summary.substring(0, 150)}`);}
      lines.push(`  链接: <${item.url}>`);
      lines.push(`  风险: ${item.risk_level} | 情感: ${item.sentiment}`);
    }
    lines.push('');
    totalCount += info.count;
  }

  if (!hasResults) {
    const [kw] = configLoader.getKeywords();
    lines.push(`今日各平台均无 ${kw} 相关内容。`);
    lines.push('');
  }

  lines.push(`📊 合计: ${totalCount} 条`);
  lines.push(`⚠️ 风险: 高${report.summary.riskLevels.high} · 中${report.summary.riskLevels.medium} · 低${report.summary.riskLevels.low}`);

  if (report.recommendations) {
    lines.push('');
    lines.push('💡 建议:');
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  return lines.join('\n');
}

/**
 * 打印报告到控制台
 * @param {Object} report - 报告对象
 */
function printReport(report) {
  const output = printPlatformCategorized(report);
  console.log(output);
}

/**
 * 格式化源名称（处理 rss:hostname 格式）
 * @param {string} sourceKey - 源标识（如 'rss:sspai.com', 'github', 'google-news'）
 * @returns {string} 格式化后的显示名称
 */
function formatSourceName(sourceKey) {
  if (sourceKey.startsWith('rss:')) {
    const hostname = sourceKey.slice(4);
    return `RSS: ${hostname}`;
  }
  if (sourceKey.startsWith('web-search:')) {
    const hostname = sourceKey.slice(11);
    return `Web搜索: ${hostname}`;
  }
  return SOURCE_DISPLAY_NAMES[sourceKey] || sourceKey;
}

/**
 * 生成历史总结（汇总所有历史数据）
 * @returns {Object} 历史总结数据
 */
function generateHistorySummary() {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');

  const files = fs.readdirSync(dataDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  if (files.length === 0) {return null;}

  let totalItems = 0;
  const platforms = {};
  const riskLevels = { high: 0, medium: 0, low: 0 };
  const sentiments = { positive: 0, negative: 0, neutral: 0 };
  const keywords = {};
  const dailyCounts = [];

  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    if (!data.items) {continue;}
    const date = f.replace('.json', '');
    dailyCounts.push({ date, count: data.items.length });

    for (const item of data.items) {
      totalItems++;
      const p = item.platform || 'other';
      platforms[p] = (platforms[p] || 0) + 1;
      riskLevels[item.risk_level || 'low']++;
      sentiments[item.sentiment || 'neutral']++;
      const kw = item.keyword || 'unknown';
      keywords[kw] = (keywords[kw] || 0) + 1;
    }
  }

  // 找出最活跃的平台 Top 5
  const topPlatforms = Object.entries(platforms)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // 找出日均条数
  const avgDaily = (totalItems / files.length).toFixed(1);

  // 找出最高单日
  const peakDay = dailyCounts.reduce((max, d) => d.count > max.count ? d : max, { date: '-', count: 0 });

  return {
    days: files.length,
    dateRange: { start: files[0].replace('.json', ''), end: files[files.length - 1].replace('.json', '') },
    totalItems,
    avgDaily,
    peakDay,
    riskLevels,
    sentiments,
    topPlatforms,
    keywords,
    dailyCounts,
  };
}

module.exports = {
  filterItems,
  RISK_KEYWORDS,
  SENTIMENT_KEYWORDS,
  PLATFORM_CATEGORIES,
  SEARCH_TYPE_PLATFORMS,
  SOURCE_DISPLAY_NAMES,
  SOURCE_DISPLAY_ORDER,
  PLATFORM_TO_SOURCE,
  assessRisk,
  analyzeSentiment,
  updateRiskLevels,
  generateSummary,
  generateDailyReport,
  generatePeriodReport,
  generateDailySummary,
  formatSourceName,
  printPlatformCategorized,
  printReport,
  formatTimestamp,
  generateHistorySummary,
};
