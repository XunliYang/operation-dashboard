/**
 * timeExtractor.js - 统一时间提取模块
 * 分层提取策略：结构化数据 > 特殊平台处理 > Firecrawl 元数据 > LLM 提取 > 兜底
 */

const https = require('https');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv optional
}

// LLM API 配置
const LLM_API_KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-3.7-plus';

// LLM 提取超时（毫秒）
const LLM_TIMEOUT = 15000;

/**
 * 判断是否为默认/占位符时间戳
 * @param {string} timestamp - ISO 8601 时间戳
 * @param {string} dateStr - 当天日期 YYYY-MM-DD
 * @returns {boolean}
 */
function isDefaultTimestamp(timestamp, dateStr) {
  if (!timestamp) {return true;}
  return timestamp.startsWith(`${dateStr}T09:00:00`);
}

/**
 * 修正年份（处理只有月日没有年份的情况）
 * @param {Date} parsed - 解析后的日期
 * @param {string} timeStr - 原始时间字符串
 * @param {number} currentYear - 当前年份
 * @returns {Date}
 */
function correctYear(parsed, timeStr, currentYear) {
  const year = parsed.getFullYear();
  if (year >= currentYear - 1 && year <= currentYear + 1) {return parsed;}
  const yearMatch = timeStr.match(/(\d{4})/);
  if (yearMatch) {
    const foundYear = parseInt(yearMatch[1]);
    if (foundYear >= 2000 && foundYear <= 2100) {
      return new Date(timeStr.replace(yearMatch[1], currentYear));
    }
    return parsed;
  }
  return new Date(timeStr.replace(/^(\d{2})-(\d{2})/, `${currentYear}-$1-$2`));
}

/**
 * 优先级 1a: 从 RSS/API 的结构化数据提取时间
 * @param {Object} item - 数据条目
 * @returns {string|null} ISO 时间戳或 null
 */
function extractFromStructuredData(item) {
  // 已有有效时间戳
  if (item.timestamp && !isNaN(new Date(item.timestamp).getTime())) {
    // 检查是否为占位符时间
    const today = new Date().toISOString().split('T')[0];
    if (!isDefaultTimestamp(item.timestamp, today)) {
      return item.timestamp;
    }
  }
  
  // pubDate 字段（RSS 标准）
  if (item.pubDate) {
    const parsed = new Date(item.pubDate);
    if (!isNaN(parsed.getTime())) {
      console.log(`[timeExtractor] 使用 pubDate: ${item.pubDate}`);
      return parsed.toISOString();
    }
  }
  
  // created_at / updated_at 字段（API 标准）
  for (const field of ['created_at', 'updated_at', 'published_at', 'create_time']) {
    if (item[field]) {
      const parsed = new Date(item[field]);
      if (!isNaN(parsed.getTime())) {
        console.log(`[timeExtractor] 使用 ${field}: ${item[field]}`);
        return parsed.toISOString();
      }
    }
  }
  
  return null;
}

/**
 * 优先级 1b: 从 HTML <time> 标签提取时间
 * @param {string} html - HTML 内容
 * @returns {string|null} ISO 时间戳或 null
 */
function extractFromTimeTag(html) {
  if (!html) {return null;}
  
  const timeTagPattern = /<time[^>]*datetime=["']([^"']+)["'][^>]*>/gi;
  let match;
  const candidates = [];
  
  while ((match = timeTagPattern.exec(html)) !== null) {
    const [context, datetime] = match;
    const parsed = new Date(datetime);
    if (!isNaN(parsed.getTime())) {
      const isPublishTime = /itemprop=["'](datePublished|published)["']/i.test(context) ||
                           /class=["'][^"']*(publish|date|time)[^"']*["']/i.test(context);
      candidates.push({ datetime, parsed: parsed.toISOString(), isPublishTime });
    }
  }
  
  if (candidates.length > 0) {
    const publishCandidate = candidates.find(c => c.isPublishTime);
    const candidate = publishCandidate || candidates[0];
    console.log(`[timeExtractor] 使用 HTML time 标签: ${candidate.datetime}`);
    return candidate.parsed;
  }
  
  return null;
}

/**
 * 优先级 1c: 从 HTML class 属性提取时间
 * @param {string} html - HTML 内容
 * @returns {string|null} ISO 时间戳或 null
 */
function extractFromClass(html) {
  if (!html) {return null;}
  
  const patterns = [
    {
      pattern: /<[^>]+class=["'][^"']*(?:time|published|date|posted|created|updated)[^"']*["'][^>]+datetime=["']([^"']+)["'][^>]*>/gi,
      extract: (m) => m[1],
    },
    {
      pattern: /<[^>]+class=["'][^"']*(?:time|published|date|posted|created|updated)[^"']*["'][^>]*>([^<]+)</gi,
      extract: (m) => m[1],
    },
    {
      pattern: /<[^>]+itemprop=["'][^"']*(?:datePublished|dateModified|dateCreated)[^"']*["'][^>]+datetime=["']([^"']+)["'][^>]*>/gi,
      extract: (m) => m[1],
    },
  ];
  
  const candidates = [];
  const currentYear = new Date().getFullYear();
  
  for (const {pattern, extract} of patterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(html)) !== null) {
      const timeStr = extract(match);
      if (!timeStr) {continue;}
      let parsed = new Date(timeStr);
      
      if (isNaN(parsed.getTime())) {continue;}
      parsed = correctYear(parsed, timeStr, currentYear);
      
      if (!isNaN(parsed.getTime())) {
        candidates.push({ datetime: timeStr, parsed: parsed.toISOString() });
      }
    }
  }
  
  if (candidates.length > 0) {
    candidates.sort((a, b) => new Date(b.parsed) - new Date(a.parsed));
    const [latest] = candidates;
    console.log(`[timeExtractor] 使用 class 时间匹配: ${latest.datetime}`);
    return latest.parsed;
  }
  
  return null;
}

/**
 * 优先级 2: 从 Firecrawl 元数据提取时间
 * @param {Object} metadata - Firecrawl 返回的元数据
 * @returns {string|null} ISO 时间戳或 null
 */
function extractFromMeta(metadata) {
  if (!metadata) {return null;}
  
  // 优先找更新时间（最新）
  const updateTimeKeys = [
    'article:modified_time',
    'og:article:modified_time',
    'modifiedTime',
    'dateModified',
    'article:updated_time',
    'og:updated_time',
  ];
  
  for (const key of updateTimeKeys) {
    if (metadata[key]) {
      const parsed = new Date(metadata[key]);
      if (!isNaN(parsed.getTime())) {
        console.log(`[timeExtractor] 使用元数据更新时间: ${key}`);
        return parsed.toISOString();
      }
    }
  }
  
  // 再找发布时间
  const publishTimeKeys = [
    'article:published_time',
    'publishedTime',
    'datePublished',
    'pubDate',
    'og:article:published_time',
  ];
  
  for (const key of publishTimeKeys) {
    if (metadata[key]) {
      const parsed = new Date(metadata[key]);
      if (!isNaN(parsed.getTime())) {
        console.log(`[timeExtractor] 使用元数据发布时间: ${key}`);
        return parsed.toISOString();
      }
    }
  }
  
  return null;
}

/**
 * 优先级 2b: 微博移动端 API 提取时间
 * @param {string} url - 微博 URL
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
function fetchWeiboMobileTime(url) {
  return new Promise((resolve) => {
    const weiboShortMatch = url && url.match(/weibo\.com\/(\d+)\/([A-Za-z0-9]+)/);
    if (!weiboShortMatch) {
      resolve(null);
      return;
    }

    const [, , mid] = weiboShortMatch;
    const apiUrl = `https://m.weibo.cn/api/statuses/show?id=${mid}`;

    const options = {
      hostname: 'm.weibo.cn',
      port: 443,
      path: `/api/statuses/show?id=${mid}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': `https://m.weibo.cn/detail/${mid}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location;
        const redirectMatch = redirectUrl.match(/detail\/([A-Za-z0-9]+)/);
        if (redirectMatch) {
          fetchWeiboMobileTime(redirectUrl).then(resolve);
          return;
        }
        resolve(null);
        return;
      }

      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json && json.data) {
            const timeField = json.data.created_at || json.data.create_at || json.data.time;
            if (timeField) {
              const parsed = new Date(timeField);
              if (!isNaN(parsed.getTime())) {
                console.log(`[timeExtractor] 微博移动端时间: ${timeField}`);
                resolve(parsed.toISOString());
                return;
              }
            }
          }

          const createdAtMatch = body.match(/"created_at"\s*:\s*"([^"]+)"/);
          if (createdAtMatch) {
            const parsed = new Date(createdAtMatch[1]);
            if (!isNaN(parsed.getTime())) {
              console.log(`[timeExtractor] 微博移动端时间(HTML): ${createdAtMatch[1]}`);
              resolve(parsed.toISOString());
              return;
            }
          }

          resolve(null);
        } catch (e) {
          console.warn(`[timeExtractor] 微博解析失败: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

/**
 * 优先级 2c: 知乎直接 HTTP 提取时间（绕过缓存）
 * @param {string} url - 知乎 URL
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
function fetchZhihuTime(url) {
  return new Promise((resolve) => {
    const zhihuMatch = url && url.match(/zhihu\.com\/(p|question\/\d+\/answer\/\d+|question\/\d+)/);
    if (!zhihuMatch) {
      resolve(null);
      return;
    }

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const createdMatch = body.match(/"created"\s*:\s*(\d{10,13})/);
          if (createdMatch) {
            const ts = parseInt(createdMatch[1]);
            const parsed = new Date(ts < 10000000000 ? ts * 1000 : ts);
            if (!isNaN(parsed.getTime())) {
              console.log(`[timeExtractor] 知乎时间戳: ${ts}`);
              resolve(parsed.toISOString());
              return;
            }
          }

          const createdTimeMatch = body.match(/"created_time"\s*:\s*(\d{10,13})/);
          if (createdTimeMatch) {
            const ts = parseInt(createdTimeMatch[1]);
            const parsed = new Date(ts < 10000000000 ? ts * 1000 : ts);
            if (!isNaN(parsed.getTime())) {
              console.log(`[timeExtractor] 知乎时间戳: ${ts}`);
              resolve(parsed.toISOString());
              return;
            }
          }

          resolve(null);
        } catch (e) {
          console.warn(`[timeExtractor] 知乎解析失败: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

/**
 * 优先级 3: 使用 LLM 从正文提取时间
 * @param {string} content - 页面正文（前 1000 字）
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
async function extractByLLM(content) {
  if (!LLM_API_KEY) {
    console.log('[timeExtractor] LLM API Key 未配置，跳过 LLM 提取');
    return null;
  }
  
  if (!content || content.length < 50) {
    return null;
  }
  
  // 截取前 1000 字
  const truncatedContent = content.substring(0, 1000);
  
  const prompt = `从以下网页内容中提取发布日期。返回 ISO 8601 格式（YYYY-MM-DD）。
如果无法确定，返回 "unknown"。

内容：
${truncatedContent}

发布日期：`;

  try {
    const postData = JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: '你是一个日期提取助手。只返回日期或 "unknown"，不要解释。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const result = await new Promise((resolve, reject) => {
      const url = new URL(`${LLM_BASE_URL}/chat/completions`);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LLM_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: LLM_TIMEOUT,
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const text = json.choices?.[0]?.message?.content?.trim() || '';
            resolve(text);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('LLM 请求超时'));
      });

      req.write(postData);
      req.end();
    });

    // 解析 LLM 返回的日期
    if (result && result !== 'unknown') {
      const parsed = new Date(result);
      if (!isNaN(parsed.getTime())) {
        console.log(`[timeExtractor] LLM 提取时间: ${result}`);
        return parsed.toISOString();
      }
    }
    
    console.log('[timeExtractor] LLM 返回 unknown');
    return null;
  } catch (err) {
    console.warn(`[timeExtractor] LLM 提取失败: ${err.message}`);
    return null;
  }
}

/**
 * 优先级 4: 兜底 - 使用采集时间，标记为 estimated
 * @param {string} fallbackDate - 兜底日期 YYYY-MM-DD
 * @returns {Object} { timestamp: string, estimated: boolean }
 */
function extractFallback(fallbackDate) {
  const timestamp = new Date(`${fallbackDate}T09:00:00Z`).toISOString();
  return { timestamp, estimated: true };
}

/**
 * 统一时间提取入口
 * 按优先级尝试：结构化数据 > 特殊平台 > HTML time 标签 > HTML class > 元数据 > LLM > 兜底
 * @param {Object} options - 提取选项
 * @param {Object} options.item - 数据条目
 * @param {Object} options.scrapeResult - Firecrawl 抓取结果 { markdown, html, metadata }
 * @param {string} options.fallbackDate - 兜底日期
 * @param {string} options.url - 原始 URL（用于特殊平台处理）
 * @returns {Promise<Object>} { timestamp: string, estimated: boolean, method: string }
 */
async function extract(options) {
  const { item = {}, scrapeResult = {}, fallbackDate, url } = options;
  const { markdown = '', html = '', metadata = {} } = scrapeResult;
  
  // 优先级 1a: 结构化数据
  const structuredTime = extractFromStructuredData(item);
  if (structuredTime) {
    return { timestamp: structuredTime, estimated: false, method: 'structured' };
  }
  
  // 优先级 2a: 微博移动端 API
  if (url && /weibo\.com\/\d+\/[A-Za-z0-9]+/.test(url)) {
    try {
      const weiboTime = await fetchWeiboMobileTime(url);
      if (weiboTime) {
        return { timestamp: weiboTime, estimated: false, method: 'weibo-mobile' };
      }
    } catch (e) {
      console.warn(`[timeExtractor] 微博移动端提取失败: ${e.message}`);
    }
  }
  
  // 优先级 2b: 知乎直接 HTTP
  if (url && /zhihu\.com\/(p|question)/.test(url)) {
    try {
      const zhihuTime = await fetchZhihuTime(url);
      if (zhihuTime) {
        return { timestamp: zhihuTime, estimated: false, method: 'zhihu-direct' };
      }
    } catch (e) {
      console.warn(`[timeExtractor] 知乎直接提取失败: ${e.message}`);
    }
  }
  
  // 优先级 1b: HTML <time> 标签
  const timeTagResult = extractFromTimeTag(html);
  if (timeTagResult) {
    return { timestamp: timeTagResult, estimated: false, method: 'html-time-tag' };
  }
  
  // 优先级 1c: HTML class 属性
  const classResult = extractFromClass(html);
  if (classResult) {
    return { timestamp: classResult, estimated: false, method: 'html-class' };
  }
  
  // 优先级 2c: Firecrawl 元数据
  const metaResult = extractFromMeta(metadata);
  if (metaResult) {
    return { timestamp: metaResult, estimated: false, method: 'metadata' };
  }
  
  // 优先级 3: LLM 提取
  const llmContent = markdown || item.snippet || item.title || '';
  const llmResult = await extractByLLM(llmContent);
  if (llmResult) {
    return { timestamp: llmResult, estimated: false, method: 'llm' };
  }
  
  // 优先级 4: 兜底
  const fallback = extractFallback(fallbackDate);
  return { timestamp: fallback.timestamp, estimated: true, method: 'fallback' };
}

/**
 * 批量提取时间
 * @param {Array} items - 数据条目数组
 * @param {Object} scrapeResults - 抓取结果映射 { url: scrapeResult }
 * @param {string} fallbackDate - 兜底日期
 * @returns {Promise<Array>} 更新后的条目数组
 */
async function extractBatch(items, scrapeResults = {}, fallbackDate) {
  const results = [];
  
  for (const item of items) {
    const scrapeResult = scrapeResults[item.url] || {};
    const result = await extract({
      item,
      scrapeResult,
      fallbackDate,
      url: item.url,
    });
    
    results.push({
      ...item,
      timestamp: result.timestamp,
      _timeEstimated: result.estimated,
      _timeMethod: result.method,
    });
  }
  
  return results;
}

module.exports = {
  extract,
  extractBatch,
  extractFromStructuredData,
  extractFromTimeTag,
  extractFromClass,
  extractFromMeta,
  extractByLLM,
  extractFallback,
  fetchWeiboMobileTime,
  fetchZhihuTime,
  isDefaultTimestamp,
};
