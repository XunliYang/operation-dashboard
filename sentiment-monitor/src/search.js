/**
 * search.js - 舆情搜索模块
 * 负责从网络检索相关内容，支持多查询变体和日期过滤
 */

const path = require('path');
const fs = require('fs');

// 加载配置文件
const configPath = path.join(__dirname, '..', 'config.json');
let config = { sites: [], searchVariants: [] };

try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (err) {
  console.warn('[search] 无法加载配置文件，使用默认配置:', err.message);
}

const configLoader = require('./configLoader');

function getSearchVariants(keyword) {
  return configLoader.getSearchVariants(keyword);
}

// 定向站点搜索目标（从配置文件读取）
const SITE_TARGETS = config.sites || [];

// 平台识别映射
const PLATFORM_PATTERNS = {
  twitter: ['twitter.com', 'x.com'],
  weibo: ['weibo.com', 'weibo.cn'],
  zhihu: ['zhihu.com'],
  github: ['github.com'],
  'google-news': ['news.google.com', 'news.google.', 'google.com/search?tbm=nws'],
  'bing-news': ['bing.com/news'],
  news: ['news.', '.news', 'reuters.com', 'bloomberg.com', 'techcrunch.com'],
  // 中文平台
  bilibili: ['bilibili.com'],
  weixin: ['mp.weixin.qq.com', 'weixin.qq.com'],
  csdn: ['csdn.net', 'blog.csdn.net'],
  juejin: ['juejin.cn'],
  toutiao: ['toutiao.com'],
  '36kr': ['36kr.com'],
  sspai: ['sspai.com'],
};

/**
 * 从 URL 识别平台
 * @param {string} url - 目标 URL
 * @returns {string} 平台名称
 */
function identifyPlatform(url) {
  if (!url) {return 'other';}
  
  const urlLower = url.toLowerCase();
  
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    for (const pattern of patterns) {
      if (urlLower.includes(pattern)) {
        return platform;
      }
    }
  }
  
  return 'other';
}

/**
 * 去重并合并搜索结果
 * @param {Array} allResults - 所有结果数组（会被修改）
 * @param {Set} seenUrls - 已见的 URL 集合（会被修改）
 * @param {Array} newResults - 新搜索结果
 * @param {string} platform - 平台标签（可选）
 */
function deduplicate(allResults, seenUrls, newResults, platform = null) {
  if (!newResults || !Array.isArray(newResults)) {return;}
  
  for (const item of newResults) {
    const url = item.url || item.link;
    if (!url || seenUrls.has(url)) {
      continue;
    }
    
    seenUrls.add(url);
    
    allResults.push({
      platform: platform || identifyPlatform(url),
      title: item.title || '',
      url,
      snippet: item.snippet || item.description || '',
      timestamp: item.published_date || item.date || new Date().toISOString(),
      risk_level: 'pending', // 待风险评估
    });
  }
}

/**
 * 执行定向站点搜索
 * @param {Function} webSearchFn - web_search 工具函数
 * @param {string} keyword - 搜索关键词
 * @param {Object} opts - 选项
 * @param {string} opts.dateAfter - 起始日期 (YYYY-MM-DD)
 * @param {string} opts.dateBefore - 结束日期 (YYYY-MM-DD)，不包含当日
 * @param {string} opts.freshness - 时间过滤 (day/week/month/year)
 * @returns {Promise<Array>} 合并去重后的结果
 */
async function searchBySites(webSearchFn, keyword, opts = {}) {
  const { dateAfter, dateBefore, freshness } = opts;
  
  console.log(`[search] 开始定向站点搜索: "${keyword}"`);
  
  const allResults = [];
  const seenUrls = new Set();
  
  for (const siteTarget of SITE_TARGETS) {
    const { platform, query: siteQuery } = siteTarget;
    const fullQuery = `${keyword} ${siteQuery}`;
    
    console.log(`[search] 定向搜索 [${platform}]: "${fullQuery}"`);
    
    try {
      const searchOpts = {
        query: fullQuery,
        count: 10,
      };
      
      // 添加日期过滤
      if (dateAfter) {searchOpts.date_after = dateAfter;}
      if (dateBefore) {searchOpts.date_before = dateBefore;}
      if (freshness) {searchOpts.freshness = freshness;}
      
      const results = await webSearchFn(searchOpts);
      
      // 使用指定平台名称进行标记
      deduplicate(allResults, seenUrls, results, platform);
      
      // 避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // 某个站点搜索失败不应阻塞其他站点
      console.warn(`[search] 定向搜索 [${platform}] 出错:`, error.message);
    }
  }
  
  console.log(`[search] 定向站点搜索完成，共获取 ${allResults.length} 条结果`);
  
  return allResults;
}

/**
 * 执行多查询变体搜索并合并去重
 * @param {Function} webSearchFn - web_search 工具函数
 * @param {string} dateAfter - 起始日期 (YYYY-MM-DD)
 * @param {string} dateBefore - 结束日期 (YYYY-MM-DD)，不包含当日
 * @param {Object} opts - 选项
 * @param {string} opts.freshness - 时间过滤 (day/week/month/year)
 * @returns {Promise<Array>} 合并去重后的结果
 */
async function performSearch(webSearchFn, keyword, dateAfter, dateBefore, opts = {}) {
  const { freshness } = opts;
  console.log(`[search] 开始搜索 ${keyword} 相关内容 (${dateAfter} ~ ${dateBefore})`);
  
  const allResults = [];
  const seenUrls = new Set();
  
  const variants = getSearchVariants(keyword);
  for (const query of variants) {
    console.log(`[search] 查询变体: "${query}"`);
    
    try {
      const searchOpts = {
        query,
        date_after: dateAfter,
        date_before: dateBefore,
        count: 10,
      };
      
      // 添加 freshness 过滤
      if (freshness) {searchOpts.freshness = freshness;}
      
      const results = await webSearchFn(searchOpts);
      
      // 使用 deduplicate 函数处理结果
      deduplicate(allResults, seenUrls, results);
      
      // 避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[search] 查询 "${query}" 出错:`, error.message);
    }
  }
  
  console.log(`[search] 共获取 ${allResults.length} 条去重后的结果`);
  
  return allResults;
}

module.exports = {
  getSearchVariants,
  SITE_TARGETS,
  PLATFORM_PATTERNS,
  identifyPlatform,
  deduplicate,
  performSearch,
  searchBySites,
};