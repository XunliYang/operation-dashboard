/**
 * firecrawl-enricher.js - 使用 Firecrawl 补充 web_search 结果的发布时间和摘要
 * 
 * 用途：对于 web_search 采集到的无发布时间（default timestamp）的数据，
 * 通过 Firecrawl 抓取页面，提取真实的发布时间和摘要。
 * 
 * 调用时机：在 mergeWebSearch 之后，发送邮件之前
 */

const { exec } = require('child_process');
const path = require('path');

// 确保加载 .env（兼容 dotenvx 和 dotenv）
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenvx 可能已经加载过
}

// Firecrawl API (通过 CLI 调用)
const FIRECRAWL_TIMEOUT = 30000;

/**
 * 判断是否为 default timestamp（占位符时间）
 * @param {string} timestamp - ISO 8601 时间戳
 * @param {string} dateStr - 当天日期 YYYY-MM-DD
 * @returns {boolean}
 */
function isDefaultTimestamp(timestamp, dateStr) {
  if (!timestamp) {return true;}
  // 匹配当天日期的 09:00:00 占位符
  return timestamp.startsWith(`${dateStr  }T09:00:00`);
}

/**
 * 从 HTML 中通过 class 匹配时间相关元素
 * @param {string} html - HTML 内容
 * @returns {string|null} ISO 时间戳或 null
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

function extractTimeFromClass(html) {
  // 匹配任何包含 time/published/date/posted/created 等关键词的 class 属性
  // 并尝试获取 datetime 属性或文本内容
  const patterns = [
    // 带 datetime 属性的（优先级最高）
    {
      pattern: /<[^>]+class=["'][^"']*(?:time|published|date|posted|created|updated)[^"']*["'][^>]+datetime=["']([^"']+)["'][^>]*>/gi,
      extract: (m) => m[1],
    },
    // 不带 datetime，直接文本内容的
    {
      pattern: /<[^>]+class=["'][^"']*(?:time|published|date|posted|created|updated)[^"']*["'][^>]*>([^<]+)</gi,
      extract: (m) => m[1],
    },
    // 匹配 itemprop 包含时间关键词的
    {
      pattern: /<[^>]+itemprop=["'][^"']*(?:datePublished|dateModified|dateCreated)[^"']*["'][^>]+datetime=["']([^"']+)["'][^>]*>/gi,
      extract: (m) => m[1],
    },
  ];
  
  const candidates = [];
  const currentYear = new Date().getFullYear();
  
  for (const {pattern, extract} of patterns) {
    let match;
    // 重置正则状态
    pattern.lastIndex = 0;
    while ((match = pattern.exec(html)) !== null) {
      const timeStr = extract(match);
      if (!timeStr) {continue;}
      let parsed = new Date(timeStr);
      
      if (isNaN(parsed.getTime())) {continue;}
      parsed = correctYear(parsed, timeStr, currentYear);
      
      if (!isNaN(parsed.getTime())) {
        candidates.push({
          datetime: timeStr,
          parsed: parsed.toISOString(),
        });
      }
    }
  }
  
  if (candidates.length > 0) {
    // 按时间排序，选择最新的
    candidates.sort((a, b) => new Date(b.parsed) - new Date(a.parsed));
    const [latest] = candidates;
    console.log(`[firecrawl] 使用class时间匹配: ${latest.datetime} → ${latest.parsed} (最新，共${candidates.length}个候选)`);
    return latest.parsed;
  }
  
  return null;
}

/**
 * 从 HTML 中提取 <time datetime="..."> 标签（特别是 class="published" 或 itemprop="datePublished"）
 * @param {string} html - HTML 内容
 * @returns {string|null} ISO 时间戳或 null
 */
function extractTimeFromTimeTag(html) {
  // 匹配 <time> 标签，优先找 datetime 属性
  const timeTagPattern = /<time[^>]*datetime=["']([^"']+)["'][^>]*>/gi;
  let match;
  const datetimeCandidates = [];
  while ((match = timeTagPattern.exec(html)) !== null) {
    const [context, datetime] = match;
    const parsed = new Date(datetime);
    if (!isNaN(parsed.getTime())) {
      // 判断是否是发布时间（通过 itemprop, class 等判断）
      const isPublishTime = /itemprop=["'](datePublished|published)["']/i.test(context) ||
                           /class=["'][^"']*(publish|date|time)[^"']*["']/i.test(context);
      datetimeCandidates.push({ datetime, parsed: parsed.toISOString(), isPublishTime });
    }
  }
  if (datetimeCandidates.length > 0) {
    // 优先选择标记为发布时间的
    const publishCandidate = datetimeCandidates.find(c => c.isPublishTime);
    const candidate = publishCandidate || datetimeCandidates[0];
    console.log(`[firecrawl] 使用HTML time标签: ${candidate.datetime} → ${candidate.parsed}`);
    return candidate.parsed;
  }
  return null;
}

/**
 * 从 Firecrawl markdown 中提取发布日期
 * 优先级：微博移动端API > 知乎直接提取 > metadata 更新时间 > HTML class时间匹配 > HTML time标签 > Unix时间戳 > 正文日期模式 > 相对时间 > metadata 发布时间
 * @param {Object} scrapeResult - Firecrawl 返回的结果 { markdown, metadata }
 * @param {string} fallbackDate - 兜底日期（当天）
 * @param {string} [url] - 原始 URL（用于微博移动端提取）
 * @returns {string} ISO 8601 时间戳
 */
async function extractPublishDate(scrapeResult, fallbackDate, url) {
  const { markdown = '', metadata = {} } = scrapeResult || {};
  
  // 0. 如果是微博短 URL，先尝试移动端 API
  if (url && /weibo\.com\/\d+\/[A-Za-z0-9]+/.test(url)) {
    try {
      const mobileTime = await fetchWeiboMobileTime(url);
      if (mobileTime) {
        console.log(`[firecrawl] 使用微博移动端时间: ${mobileTime}`);
        return mobileTime;
      }
    } catch (e) {
      console.warn(`[firecrawl] 微博移动端提取失败: ${e.message}`);
    }
  }
  
  // 0.1 如果是知乎 URL，使用直接 HTTP 请求绕过缓存
  if (url && /zhihu\.com\/(p|question)/.test(url)) {
    try {
      const zhihuTime = await fetchZhihuTime(url);
      if (zhihuTime) {
        console.log(`[firecrawl] 使用知乎直接提取时间: ${zhihuTime}`);
        return zhihuTime;
      }
    } catch (e) {
      console.warn(`[firecrawl] 知乎直接提取失败: ${e.message}`);
    }
  }
  
  // 1. 优先从 metadata 提取**更新时间**（最新）
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
        console.log(`[firecrawl] 使用更新时间: ${key} → ${parsed.toISOString()}`);
        return parsed.toISOString();
      }
    }
  }
  
  // 1.2 从 HTML 中提取 <time datetime="..."> 标签
  const html = scrapeResult.html || '';
  if (html) {
    const timeTagResult = extractTimeFromTimeTag(html);
    if (timeTagResult) {
      return timeTagResult;
    }
  }
  
  // 1.3 从 HTML 中通过 class 匹配时间相关元素（新增）
  if (html) {
    const classTimeResult = extractTimeFromClass(html);
    if (classTimeResult) {
      return classTimeResult;
    }
  }
  
  // 1.6 从 HTML 中提取 Unix 时间戳（知乎等平台使用 "created":1782465860 格式）
  if (html && url && url.includes('zhihu.com')) {
    const unixTimestampMatch = html.match(/"created"\s*:\s*(\d{10,13})/);
    if (unixTimestampMatch) {
      const unixTs = parseInt(unixTimestampMatch[1]);
      // 判断是秒还是毫秒（10位是秒，13位是毫秒）
      const timestamp = unixTs < 10000000000 ? unixTs * 1000 : unixTs;
      const parsed = new Date(timestamp);
      if (!isNaN(parsed.getTime())) {
        console.log(`[firecrawl] 使用知乎Unix时间戳: ${unixTs} → ${parsed.toISOString()}`);
        return parsed.toISOString();
      }
    }
  }
  
  // 2. 从正文提取相对时间（如 "5d ago" 通常表示最近活动）
  const relativeMatch = markdown.match(/(\d+)\s*(d|day|days|w|week|weeks|h|hour|hours)\s+ago/i);
  if (relativeMatch) {
    const num = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const now = new Date();
    
    if (unit.startsWith('h')) {
      now.setHours(now.getHours() - num);
    } else if (unit.startsWith('d')) {
      now.setDate(now.getDate() - num);
    } else if (unit.startsWith('w')) {
      now.setDate(now.getDate() - num * 7);
    }
    
    // enricher 只负责提取时间，不做过滤（过滤由 mergeWebSearch 负责）
    console.log(`[firecrawl] 使用相对时间: ${relativeMatch[0]} → ${now.toISOString()}`);
    return now.toISOString();
  }
  
  // 3. 从 metadata 提取**发布时间**
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
        console.log(`[firecrawl] 使用发布时间: ${key} → ${parsed.toISOString()}`);
        return parsed.toISOString();
      }
    }
  }
  
  // 4. 从正文提取绝对日期
  const absolutePatterns = [
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i,
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
  ];
  
  for (const pattern of absolutePatterns) {
    const match = markdown.match(pattern);
    if (match) {
      const parsed = new Date(match[0]);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  
  // 4.5 从微博正文提取发布时间（格式：MM-DD HH:MM 或 YYYY-MM-DD HH:MM）
  // 微博文章通常在作者信息后显示 "MM-DD HH:MM" 或 "YYYY-MM-DD HH:MM"
  const weiboDatePattern = markdown.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (weiboDatePattern) {
    const parsed = new Date(`${weiboDatePattern[1]}-${weiboDatePattern[2]}-${weiboDatePattern[3]}T${weiboDatePattern[4]}:${weiboDatePattern[5]}:00+08:00`);
    if (!isNaN(parsed.getTime())) {
      console.log(`[firecrawl] 使用微博日期: ${weiboDatePattern[0]} → ${parsed.toISOString()}`);
      return parsed.toISOString();
    }
  }
  const weiboShortDatePattern = markdown.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (weiboShortDatePattern) {
    // 微博短日期格式 MM-DD HH:MM，年份取当前年
    const year = new Date().getFullYear();
    const parsed = new Date(`${year}-${weiboShortDatePattern[1]}-${weiboShortDatePattern[2]}T${weiboShortDatePattern[3]}:${weiboShortDatePattern[4]}:00+08:00`);
    if (!isNaN(parsed.getTime())) {
      console.log(`[firecrawl] 使用微博短日期: ${weiboShortDatePattern[0]} → ${parsed.toISOString()}`);
      return parsed.toISOString();
    }
  }
  
  // 4. 从 ld+json 结构化数据中提取（某些网站 firecrawl 没解析到 metadata）
  const ldJsonMatch = markdown.match(/"datePublished"\s*:\s*"([^"]+)"/) ||
    markdown.match(/"dateModified"\s*:\s*"([^"]+)"/) ||
    markdown.match(/"date"\s*:\s*"([^"]{4,})"/);
  if (ldJsonMatch) {
    const parsed = new Date(ldJsonMatch[1]);
    if (!isNaN(parsed.getTime())) {
      console.log(`[firecrawl] 使用ld+json时间: → ${parsed.toISOString()}`);
      return parsed.toISOString();
    }
  }

  // 5. 从 og:image 路径推断日期和时间（某些网站的图片 URL 包含完整时间戳）
  // 例如: /2026/0706/20260706112842683.png → 2026-07-06 11:28:42
  const ogImage = metadata['og:image'] || metadata['twitter:image'] || '';
  // 先尝试完整时间戳: 20260706112842
  const fullTimestampMatch = ogImage.match(/(\d{4})\/(\d{4})\/(\d{14})/);
  if (fullTimestampMatch) {
    const [, year, mmDd, timeStr] = fullTimestampMatch;
    const mm = mmDd.substring(0, 2);
    const dd = mmDd.substring(2, 4);
    const hh = timeStr.substring(8, 10);
    const min = timeStr.substring(10, 12);
    const ss = timeStr.substring(12, 14);
    const parsed = new Date(`${year}-${mm}-${dd}T${hh}:${min}:${ss}+08:00`);
    if (!isNaN(parsed.getTime())) {
      console.log(`[firecrawl] 使用og:image时间戳: → ${parsed.toISOString()}`);
      return parsed.toISOString();
    }
  }
  const imageDateMatch = ogImage.match(/\/(\d{4})\/(\d{4})\//);
  if (imageDateMatch) {
    const [, year, monthDay] = imageDateMatch;
    if (monthDay.length === 4) {
      const month = monthDay.substring(0, 2);
      const day = monthDay.substring(2, 4);
      const parsed = new Date(`${year}-${month}-${day}T00:00:00+08:00`);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  // 6. 兜底：返回传入的 fallbackDate
  return new Date(`${fallbackDate  }T09:00:00Z`).toISOString();
}

/**
 * 从 Firecrawl markdown 提取摘要
 * @param {Object} scrapeResult - Firecrawl 返回的结果
 * @param {string} fallbackSnippet - 原始摘要（来自搜索引擎）
 * @returns {string} 更详细的摘要
 */
function extractSnippet(scrapeResult, fallbackSnippet) {
  const { markdown = '', metadata = {} } = scrapeResult || {};
  
  // 优先使用 metadata 中的描述
  const metaDesc = metadata['og:description'] || metadata.description || metadata['twitter:description'];
  if (metaDesc && metaDesc.length > 50) {
    return metaDesc.substring(0, 300);
  }
  
  // 从正文提取（跳过导航、广告等）
  const lines = markdown.split('\n').filter(l => l.trim().length > 20);
  
  // 找到第一个有意义的段落（排除标题、链接、图片）
  for (const line of lines.slice(0, 20)) {
    const trimmed = line.trim();
    // 跳过明显的非内容行
    if (trimmed.startsWith('![') || 
        trimmed.startsWith('[![') ||
        trimmed.startsWith('- ') ||
        trimmed.startsWith('| ') ||
        trimmed.match(/^\d+\.\s/) ||
        trimmed.length < 50) {
      continue;
    }
    // 找到看起来像正文的段落
    if (trimmed.length > 100 && !trimmed.includes('Sign in') && !trimmed.includes('Subscribe')) {
      return trimmed.substring(0, 300);
    }
  }
  
  // 兜底：返回原始摘要
  return fallbackSnippet || '';
}

/**
 * 从微博移动端 JSON API 提取发布时间
 * @param {string} url - 微博 URL（如 weibo.com/{uid}/{mid}）
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
function fetchWeiboMobileTime(url) {
  return new Promise((resolve) => {
    // 只处理微博短帖格式：weibo.com/{uid}/{alphanumeric}
    const weiboShortMatch = url.match(/weibo\.com\/(\d+)\/([A-Za-z0-9]+)/);
    if (!weiboShortMatch) {
      resolve(null);
      return;
    }

    const [, , mid] = weiboShortMatch;
    const apiUrl = `https://m.weibo.cn/api/statuses/show?id=${mid}`;

    const https = require('https');
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
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[weibo-mobile] 重定向到: ${res.headers.location}`);
        // 尝试从重定向目标获取
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
          // 尝试解析 JSON 响应
          const json = JSON.parse(body);
          if (json && json.data) {
            // 尝试多种时间字段
            const timeField = json.data.created_at || json.data.create_at || json.data.time;
            if (timeField) {
              const parsed = new Date(timeField);
              if (!isNaN(parsed.getTime())) {
                console.log(`[weibo-mobile] 提取发布时间: ${timeField} → ${parsed.toISOString()}`);
                resolve(parsed.toISOString());
                return;
              }
            }
          }

          // 如果不是 JSON，尝试从 HTML 中提取
          const createdAtMatch = body.match(/"created_at"\s*:\s*"([^"]+)"/);
          if (createdAtMatch) {
            const parsed = new Date(createdAtMatch[1]);
            if (!isNaN(parsed.getTime())) {
              console.log(`[weibo-mobile] 提取发布时间: ${createdAtMatch[1]} → ${parsed.toISOString()}`);
              resolve(parsed.toISOString());
              return;
            }
          }

          console.warn(`[weibo-mobile] 未找到发布时间: ${url}, status: ${res.statusCode}`);
          resolve(null);
        } catch (e) {
          console.warn(`[weibo-mobile] 解析失败 ${url}:`, e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.warn(`[weibo-mobile] 抓取失败 ${url}:`, e.message);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[weibo-mobile] 抓取超时 ${url}`);
      resolve(null);
    });

    req.end();
  });
}

/**
 * 从知乎页面提取发布时间（绕过 firecrawl 缓存，直接 HTTP 请求获取完整 HTML）
 * @param {string} url - 知乎 URL（如 zhuanlan.zhihu.com/p/xxx）
 * @returns {Promise<string|null>} ISO 时间戳或 null
 */
function fetchZhihuTime(url) {
  return new Promise((resolve) => {
    // 只处理知乎 URL
    const zhihuMatch = url.match(/zhihu\.com\/(p|question\/\d+\/answer\/\d+|question\/\d+)/);
    if (!zhihuMatch) {
      resolve(null);
      return;
    }

    const https = require('https');
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
          // 尝试提取 "created":1782465860 格式的 Unix 时间戳
          const createdMatch = body.match(/"created"\s*:\s*(\d{10,13})/);
          if (createdMatch) {
            const ts = parseInt(createdMatch[1]);
            const parsed = new Date(ts < 10000000000 ? ts * 1000 : ts);
            if (!isNaN(parsed.getTime())) {
              console.log(`[zhihu-direct] 提取发布时间: ${ts} → ${parsed.toISOString()}`);
              resolve(parsed.toISOString());
              return;
            }
          }

          // 尝试提取 "created_time":1782465860
          const createdTimeMatch = body.match(/"created_time"\s*:\s*(\d{10,13})/);
          if (createdTimeMatch) {
            const ts = parseInt(createdTimeMatch[1]);
            const parsed = new Date(ts < 10000000000 ? ts * 1000 : ts);
            if (!isNaN(parsed.getTime())) {
              console.log(`[zhihu-direct] 提取发布时间: ${ts} → ${parsed.toISOString()}`);
              resolve(parsed.toISOString());
              return;
            }
          }

          console.warn(`[zhihu-direct] 未找到发布时间: ${url}`);
          resolve(null);
        } catch (e) {
          console.warn(`[zhihu-direct] 解析失败 ${url}:`, e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.warn(`[zhihu-direct] 抓取失败 ${url}:`, e.message);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[zhihu-direct] 抓取超时 ${url}`);
      resolve(null);
    });

    req.end();
  });
}

/**
 * 调用 Firecrawl 抓取单个 URL（使用原生 https 模块，避免 exec+curl 的 shell 转义问题）
 * @param {string} url - 要抓取的 URL
 * @returns {Promise<Object>} { markdown, metadata } 或 null
 */
function scrapeWithFirecrawl(url) {
  return new Promise((resolve) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      console.warn('[firecrawl-enricher] FIRECRAWL_API_KEY 未设置，跳过');
      resolve(null);
      return;
    }

    const https = require('https');
    const postData = JSON.stringify({ url, formats: ['markdown', 'html'] });

    const options = {
      hostname: 'api.firecrawl.dev',
      port: 443,
      path: '/v1/scrape',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: FIRECRAWL_TIMEOUT,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.success && result.data) {
            resolve({
              markdown: result.data.markdown || '',
              html: result.data.html || '',
              metadata: result.data.metadata || {},
            });
          } else {
            console.warn(`[firecrawl-enricher] 抓取返回失败 ${url}:`, result.error || 'unknown');
            resolve(null);
          }
        } catch (e) {
          console.warn(`[firecrawl-enricher] 解析响应失败 ${url}:`, e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.warn(`[firecrawl-enricher] 抓取失败 ${url}:`, e.message);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[firecrawl-enricher] 抓取超时 ${url}`);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 批量补充 web_search 结果的发布时间和摘要
 * @param {Array} items - 数据条目数组
 * @param {string} dateStr - 当天日期 YYYY-MM-DD
 * @returns {Promise<Array>} 更新后的条目数组
 */
async function enrichWithFirecrawl(items, dateStr) {
  // 筛选需要补充的条目：只检查是否为占位符时间戳，不限来源平台
  const needsEnrich = items.filter(item => isDefaultTimestamp(item.timestamp, dateStr));
  
  if (needsEnrich.length === 0) {
    console.log('[firecrawl-enricher] 无需补充的 web_search 条目');
    return items;
  }
  
  console.log(`[firecrawl-enricher] 发现 ${needsEnrich.length} 条需要补充发布时间的 web_search 结果`);
  
  // 并行抓取（限制并发避免 rate limit）
  const CONCURRENT_LIMIT = 3;
  const batches = [];
  for (let i = 0; i < needsEnrich.length; i += CONCURRENT_LIMIT) {
    batches.push(needsEnrich.slice(i, i + CONCURRENT_LIMIT));
  }
  
  const enrichedItems = [...items];
  
  for (const batch of batches) {
    const results = await Promise.all(
      batch.map(async (item) => {
        console.log(`[firecrawl-enricher] 抓取: ${item.url}`);
        const scrapeResult = await scrapeWithFirecrawl(item.url);
        
        if (!scrapeResult) {
          return { url: item.url, enriched: false };
        }
        
        const newTimestamp = await extractPublishDate(scrapeResult, dateStr, item.url);
        const newSnippet = extractSnippet(scrapeResult, item.snippet);
        
        return {
          url: item.url,
          enriched: true,
          timestamp: newTimestamp,
          snippet: newSnippet,
        };
      }),
    );
    
    // 更新原数组
    for (const result of results) {
      if (!result.enriched) {continue;}
      const idx = enrichedItems.findIndex(i => i.url === result.url);
      if (idx < 0) {continue;}
      enrichedItems[idx].timestamp = result.timestamp;
      if (result.snippet && result.snippet.length > (enrichedItems[idx].snippet?.length || 0)) {
        enrichedItems[idx].snippet = result.snippet;
      }
      enrichedItems[idx]._enriched_by = 'firecrawl';
      console.log(`[firecrawl-enricher] ✓ 已补充: ${enrichedItems[idx].title?.substring(0, 40)}... → ${result.timestamp}`);
    }
    
    // 批次间短暂延迟
    if (batches.indexOf(batch) < batches.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  const enrichedCount = enrichedItems.filter(i => i._enriched_by === 'firecrawl').length;
  console.log(`[firecrawl-enricher] 完成，共补充 ${enrichedCount} 条`);
  
  return enrichedItems;
}

module.exports = {
  enrichWithFirecrawl,
  isDefaultTimestamp,
  extractPublishDate,
  extractTimeFromClass,
  extractTimeFromTimeTag,
  extractSnippet,
  scrapeWithFirecrawl,
  fetchWeiboMobileTime,
  fetchZhihuTime,
};
