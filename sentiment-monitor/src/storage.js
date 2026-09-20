/**
 * storage.js - 舆情存储模块
 * 负责将搜索结果保存为按日期分文件的 JSON 格式
 */

const fs = require('fs');
const path = require('path');
const configLoader = require('./configLoader');

// 数据存储目录
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * 校验日期格式，防止路径遍历攻击
 * @param {string} date - 日期字符串
 * @returns {string} 校验后的日期
 * @throws {Error} 如果日期格式无效
 */
function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`);
  }
  return date;
}

/**
 * 确保数据目录存在
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[storage] 创建数据目录: ${DATA_DIR}`);
  }
}

/**
 * 获取数据文件路径
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @returns {string} 文件路径
 */
function getDataFilePath(date) {
  validateDate(date);
  return path.join(DATA_DIR, `${date}.json`);
}

/**
 * 获取采集源状态文件路径
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @returns {string} 文件路径
 */
function getStatsFilePath(date) {
  validateDate(date);
  return path.join(DATA_DIR, `${date}-stats.json`);
}

/**
 * 保存搜索结果到 JSON 文件
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @param {Array} items - 搜索结果数组
 * @param {string} keyword - 搜索关键词
 * @returns {Object} 保存的数据对象
 */
function saveResults(date, items, keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  validateDate(date);
  ensureDataDir();
  
  const filePath = getDataFilePath(date);
  
  // 如果文件已存在，读取现有数据进行合并
  let existingItems = [];
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      existingItems = existing.items || [];
    } catch (e) {
      console.warn(`[storage] 读取现有文件失败，将覆盖: ${e.message}`);
    }
  }
  
  // URL 去重合并
  const urlMap = new Map();
  
  // 先添加现有项
  for (const item of existingItems) {
    if (item.url) {
      urlMap.set(item.url, item);
    }
  }
  
  // 再添加新项（覆盖旧项）
  for (const item of items) {
    if (item.url) {
      urlMap.set(item.url, item);
    }
  }
  
  const mergedItems = Array.from(urlMap.values());
  
  const data = {
    date,
    keyword: kw,
    items: mergedItems,
    filepath: filePath,
    metadata: {
      total_count: mergedItems.length,
      last_updated: new Date().toISOString(),
      platforms: countPlatforms(mergedItems),
    },
  };
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[storage] 已保存 ${mergedItems.length} 条记录到 ${filePath}`);
  
  return data;
}

/**
 * 加载指定日期的数据
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @returns {Object|null} 数据对象或 null
 */
function loadResults(date) {
  validateDate(date);
  const filePath = getDataFilePath(date);
  
  if (!fs.existsSync(filePath)) {
    console.log(`[storage] 文件不存在: ${filePath}`);
    return null;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`[storage] 加载 ${data.items?.length || 0} 条记录 from ${filePath}`);
    return data;
  } catch (e) {
    console.error(`[storage] 读取文件失败: ${e.message}`);
    return null;
  }
}

/**
 * 保存采集源状态到 JSON 文件
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @param {Object} stats - 采集源状态对象，新格式包含 { date, methods, summary }，旧格式包含 { date, sources }
 * @returns {Object} 保存的数据对象
 */
function saveSourceStats(date, stats) {
  validateDate(date);
  ensureDataDir();
  const filePath = getStatsFilePath(date);
  
  // 检查是否是新格式（包含 methods）
  const data = stats.methods ? stats : { date, sources: stats };
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[storage] 已保存采集源状态到 ${filePath}`);
  return data;
}

/**
 * 加载指定日期的采集源状态
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @returns {Object|null} 采集源状态对象或 null
 */
function loadSourceStats(date) {
  validateDate(date);
  const filePath = getStatsFilePath(date);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`[storage] 读取采集源状态文件失败: ${e.message}`);
    return null;
  }
}

/**
 * 统计各平台数量
 * @param {Array} items - 数据项
 * @returns {Object} 平台计数
 */
function countPlatforms(items) {
  const counts = {};
  for (const item of items) {
    const platform = item.platform || 'other';
    counts[platform] = (counts[platform] || 0) + 1;
  }
  return counts;
}

/**
 * 获取所有数据文件列表
 * @returns {Array<string>} 日期列表
 */
function listDataFiles() {
  ensureDataDir();
  
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('-stats.json'))
    .map(f => f.replace('.json', ''))
    .sort();
  
  return files;
}

/**
 * 获取日期范围内的数据
 * @param {string} startDate - 开始日期
 * @param {string} endDate - 结束日期
 * @returns {Array} 数据数组
 */
function getDataInRange(startDate, endDate) {
  const dates = listDataFiles();
  const results = [];
  
  for (const date of dates) {
    if (date >= startDate && date <= endDate) {
      const data = loadResults(date);
      if (data) {
        results.push(data);
      }
    }
  }
  
  return results;
}

/**
 * 从 HTML 页面提取发布时间
 * @param {string} html - HTML 内容
 * @returns {string|null} ISO 时间戳或 null
 */
function extractPublishTime(html) {
  if (!html) {return null;}
  
  const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);
  if (timeMatch) {
    const dt = new Date(timeMatch[1]);
    if (!isNaN(dt.getTime())) {return dt.toISOString();}
  }
  
  const timeContentMatch = html.match(/<time[^>]*>([^<]+)<\/time>/i);
  if (timeContentMatch) {
    const dt = new Date(timeContentMatch[1]);
    if (!isNaN(dt.getTime())) {return dt.toISOString();}
  }
  
  const metaMatch = html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                    html.match(/<meta[^>]*name=["']publishdate["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                    html.match(/<meta[^>]*name=["']publish_date["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (metaMatch) {
    const dt = new Date(metaMatch[1]);
    if (!isNaN(dt.getTime())) {return dt.toISOString();}
  }
  
  const zhihuMatch = html.match(/发布于\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/) ||
                     html.match(/编辑于\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  if (zhihuMatch) {
    const dt = new Date(zhihuMatch[1]);
    if (!isNaN(dt.getTime())) {return dt.toISOString();}
  }
  
  return null;
}

/**
 * 使用 firecrawl 获取准确的发布时间
 * @param {string} url - 页面 URL
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
async function fetchPublishTimeWithFirecrawl(url) {
  if (!url) {return null;}
  
  try {
    const { scrapeWithFirecrawl, extractPublishDate } = require('./firecrawl-enricher');
    const scrapeResult = await scrapeWithFirecrawl(url);
    if (scrapeResult) {
      const time = await extractPublishDate(scrapeResult, new Date().toISOString().split('T')[0], url);
      const parsedTime = new Date(time);
      const parsedIso = parsedTime.toISOString();
      if (time && !parsedIso.endsWith('T09:00:00.000Z') && !parsedIso.endsWith('T02:00:00.000Z')) {
        console.log(`[storage] firecrawl 提取时间成功: ${url} → ${time}`);
        return time;
      }
    }
  } catch (err) {
    console.warn(`[storage] firecrawl 抓取失败 ${url}:`, err.message);
  }
  
  return null;
}

/**
 * 抓取页面获取真实发布时间
 * @param {string} url - 页面 URL
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
async function fetchPublishTime(url) {
  if (!url) {return null;}
  
  const firecrawlTime = await fetchPublishTimeWithFirecrawl(url);
  if (firecrawlTime) {return firecrawlTime;}
  
  try {
    const http = url.startsWith('https') ? require('https') : require('http');
    const proj = configLoader.getProjectConfig();
    const html = await new Promise((resolve, reject) => {
      const req = http.get(url, {
        headers: { 'User-Agent': `Mozilla/5.0 (compatible; ${proj.userAgent})` },
        timeout: 5000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchPublishTime(res.headers.location).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    
    const time = extractPublishTime(html);
    if (time) {return time;}
  } catch (err) {
    // HTTP 也失败
  }
  
  return null;
}

/**
 * 合并 web_search 结果到当天 data 文件
 * 从 stdin 读取的 JSON 数组经标准化后，通过 saveResults 的 URL 去重逻辑合并
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @param {Array} items - web_search 结果数组
 * @returns {Object} 保存后的数据对象
 */
function mergeWebSearch(date, items) {
  validateDate(date);
  ensureDataDir();

  // 过滤无效 URL（微博分享页、重定向页等无意义链接）
  const INVALID_URL_PATTERNS = [
    /service\.weibo\.com\/share/,
    /weibo\.com\/aj\/static\//,
    /weibo\.com\/.*\?url=.*share/,
  ];
  const validItems = items.filter(item => {
    const url = item.url || '';
    const isInvalid = INVALID_URL_PATTERNS.some(p => p.test(url));
    if (isInvalid) {
      console.log(`[mergeWebSearch] 过滤无效URL: ${url.substring(0, 60)}...`);
    }
    return !isInvalid;
  });

  // 加载配置获取时间过滤参数
  const config = configLoader.loadConfig();
  
  // 计算时间截止点（默认近3天）
  const keywords = configLoader.getKeywords();
  const daysBack = config.keywordConfig?.[keywords[0]]?.daysBack || 3;
  const referenceDate = date;
  const refTime = new Date(`${referenceDate  }T23:59:59+08:00`).getTime();
  const cutoff = refTime - daysBack * 24 * 60 * 60 * 1000;

  // 标准化 web_search 条目
  const normalized = validItems.map(item => {
    const platform = item.platform || 'web-search';
    return {
      source_method: 'web_search',
      source_detail: platform,
      platform,
      title: item.title || '',
      url: item.url || '',
      snippet: item.snippet || item.description || '',
      timestamp: item.timestamp || new Date().toISOString(),
      keyword: item.keyword || keywords[0],
    };
  });

  // 时间过滤
  const filtered = normalized.filter(item => {
    if (item.timestamp) {
      const t = new Date(item.timestamp).getTime();
      if (!isNaN(t) && t < cutoff) {
        console.log(`[mergeWebSearch] 过滤旧内容: ${item.title.substring(0, 30)}... (${item.timestamp})`);
        return false;
      }
    }
    return true;
  });

  if (filtered.length < normalized.length) {
    console.log(`[mergeWebSearch] 时间过滤: ${normalized.length} → ${filtered.length} 条`);
  }

  // 用 saveResults 合并（内部已有 URL 去重）
  return saveResults(date, filtered, keywords.join(', '));
}

module.exports = {
  DATA_DIR,
  validateDate,
  saveResults,
  mergeWebSearch,
  loadResults,
  saveSourceStats,
  loadSourceStats,
  listDataFiles,
  getDataInRange,
  countPlatforms,
};
