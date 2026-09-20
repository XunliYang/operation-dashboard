/**
 * fetcher.js - 舆情数据抓取模块
 * 使用 Node.js 原生 https 模块（零依赖）
 * 支持 RSS 源聚合、Google News、Bing News、GitHub 搜索
 */

const https = require('https');
const http = require('http');
const configLoader = require('./configLoader');

// 超时控制（毫秒）
const DEFAULT_TIMEOUT = 10000;

/**
 * 统一的时间戳解析函数
 * 支持：ISO 8601、相对时间（X hours ago/X小时前）、各种日期格式
 * @param {string} timestampStr - 时间戳字符串
 * @param {Date} referenceTime - 参考时间（默认为当前时间）
 * @returns {string} ISO 8601 格式的时间戳
 */
function parseTimestamp(timestampStr, referenceTime = new Date()) {
  if (!timestampStr) {return referenceTime.toISOString();}
  
  const str = timestampStr.toString().trim();
  
  // 1. 尝试直接解析为 Date（ISO 8601 等标准格式）
  const directDate = new Date(str);
  if (!isNaN(directDate.getTime())) {
    return directDate.toISOString();
  }
  
  // 2. 解析相对时间 - 英文
  const enRelative = str.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (enRelative) {
    const num = parseInt(enRelative[1]);
    const unit = enRelative[2].toLowerCase();
    const multipliers = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    const ms = multipliers[unit] || 0;
    return new Date(referenceTime.getTime() - num * ms).toISOString();
  }
  
  // 3. 解析相对时间 - 中文
  const zhRelative = str.match(/^(\d+)\s*(秒|分钟|小时|天|周|个月|年)前$/);
  if (zhRelative) {
    const num = parseInt(zhRelative[1]);
    const [, , unit] = zhRelative;
    const multipliers = {
      '秒': 1000,
      '分钟': 60 * 1000,
      '小时': 60 * 60 * 1000,
      '天': 24 * 60 * 60 * 1000,
      '周': 7 * 24 * 60 * 60 * 1000,
      '个月': 30 * 24 * 60 * 60 * 1000,
      '年': 365 * 24 * 60 * 60 * 1000,
    };
    const ms = multipliers[unit] || 0;
    return new Date(referenceTime.getTime() - num * ms).toISOString();
  }
  
  // 4. 解析 "just now" / "刚刚"
  if (/^(just now|刚刚)$/i.test(str)) {
    return referenceTime.toISOString();
  }
  
  // 5. 无法解析，返回参考时间
  return referenceTime.toISOString();
}


/**
 * 通用的 HTTP/HTTPS 请求封装
 * @param {string} url - 请求 URL
 * @param {Object} options - 请求选项
 * @param {number} options.timeout - 超时时间（毫秒）
 * @returns {Promise<string>} 响应内容
 */
function fetch(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT } = options;
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const customHeaders = options.headers || {};
    const req = protocol.get(url, {
      headers: {
        'User-Agent': `Mozilla/5.0 (compatible; ${configLoader.getProjectConfig().userAgent})`,
        'Accept': 'application/xml, application/rss+xml, application/atom+xml, application/json, text/xml, */*',
        ...customHeaders,
      },
      timeout,
    }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, options).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

/**
 * 简单的 XML 解析 - 提取 RSS/Atom 条目
 * 不使用外部依赖，用正则匹配
 * @param {string} xml - XML 内容
 * @param {string} type - 类型: 'rss' 或 'atom'
 * @returns {Array} 条目数组
 */
function parseRSS(xml, type = 'rss') {
  const items = [];
  
  try {
    if (type === 'atom') {
      // Atom 格式: <entry>...</entry>
      const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
      let match;
      
      while ((match = entryRegex.exec(xml)) !== null) {
        const [, entry] = match;
        
        // 提取标题
        const titleMatch = entry.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';
        
        // 提取链接
        const linkMatch = entry.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i) || 
                          entry.match(/<link[^>]*>([^<]+)<\/link>/i);
        const url = linkMatch ? linkMatch[1].trim() : '';
        
        // 提取摘要
        const summaryMatch = entry.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i) ||
                             entry.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i);
        const snippet = summaryMatch ? summaryMatch[1].trim().replace(/<[^>]+>/g, '').substring(0, 300) : '';
        
        // 提取日期
        const dateMatch = entry.match(/<updated[^>]*>([^<]+)<\/updated>/i) ||
                          entry.match(/<published[^>]*>([^<]+)<\/published>/i);
        let timestamp;
        if (dateMatch && dateMatch[1]) {
          timestamp = parseTimestamp(dateMatch[1].trim());
        } else {
          timestamp = parseTimestamp(null);
        }
        
        if (title && url) {
          items.push({ title, url, snippet, timestamp });
        }
      }
    } else {
      // RSS 2.0 格式: <item>...</item>
      const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
      let match;
      
      while ((match = itemRegex.exec(xml)) !== null) {
        const [, item] = match;
        
        // 提取标题
        const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';
        
        // 提取链接
        let linkMatch = item.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
        let url = linkMatch ? linkMatch[1].trim() : '';
        
        // 处理 HTML 实体编码
        url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        
        // 处理 Bing News 重定向链接
        if (url && url.includes('bing.com/news/apiclick.aspx')) {
          // 从 URL 参数中提取真实链接
          const urlMatch = url.match(/[?&]url=([^&]+)/);
          if (urlMatch) {
            url = decodeURIComponent(urlMatch[1]);
          }
        }
        
        // 处理 Google News 重定向链接
        if (url && url.includes('news.google.com/rss/articles/')) {
          // Google News 的链接通常是重定向，保留原样（用户点击后会跳转）
        }
        
        // 提取摘要
        const descMatch = item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
        const snippet = descMatch ? descMatch[1].trim().replace(/<[^>]+>/g, '').substring(0, 300) : '';
        
        // 提取日期
        const dateMatch = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i) ||
                          item.match(/<dc:date[^>]*>([^<]+)<\/dc:date>/i);
        let timestamp;
        if (dateMatch && dateMatch[1]) {
          timestamp = parseTimestamp(dateMatch[1].trim());
        } else {
          timestamp = parseTimestamp(null);
        }
        
        if (title && url) {
          items.push({ title, url, snippet, timestamp });
        }
      }
    }
  } catch (error) {
    console.error('[fetcher] RSS 解析错误:', error.message);
  }
  
  return items;
}

/**
 * 获取仓库最近的活动详情
 * @param {string} repoFullName - 仓库全名 (owner/repo)
 * @param {Object} headers - 请求头
 * @returns {Promise<string>} 格式化后的最近活动摘要
 */
async function fetchRepoRecentEvents(repoFullName, headers = {}) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const summaries = [];

  try {
    // 并行获取 commits, PRs, issues
    const [commitsJson, pullsJson, issuesJson] = await Promise.all([
      fetch(`https://api.github.com/repos/${repoFullName}/commits?per_page=5`, { timeout: 10000, headers }).then(r => r.json()).catch(() => []),
      fetch(`https://api.github.com/repos/${repoFullName}/pulls?state=all&sort=created&direction=desc&per_page=5`, { timeout: 10000, headers }).then(r => r.json()).catch(() => []),
      fetch(`https://api.github.com/repos/${repoFullName}/issues?state=all&sort=created&direction=desc&per_page=5&filter=all`, { timeout: 10000, headers }).then(r => r.json()).catch(() => []),
    ]);

    // 处理 commits
    if (Array.isArray(commitsJson)) {
      const recentCommits = commitsJson.filter(c => new Date(c.commit?.author?.date || c.commit?.committer?.date).getTime() > cutoff);
      for (const c of recentCommits.slice(0, 3)) {
        const msg = (c.commit?.message || '').split('\n')[0].substring(0, 60);
        if (msg) {summaries.push(`Commit: ${msg}`);}
      }
    }

    // 处理 PRs
    if (Array.isArray(pullsJson)) {
      const recentPRs = pullsJson.filter(p => new Date(p.created_at).getTime() > cutoff);
      for (const p of recentPRs.slice(0, 3)) {
        summaries.push(`PR ${p.state === 'open' ? 'opened' : 'merged'}: ${p.title?.substring(0, 50)}`);
      }
    }

    // 处理 issues (排除 PR，因为 GitHub issues API 会包含 PR)
    if (Array.isArray(issuesJson)) {
      const recentIssues = issuesJson.filter(i => !i.pull_request && new Date(i.created_at).getTime() > cutoff);
      for (const i of recentIssues.slice(0, 3)) {
        summaries.push(`Issue ${i.state === 'open' ? 'opened' : 'closed'}: ${i.title?.substring(0, 50)}`);
      }
    }

    return summaries.join('; ');
  } catch (err) {
    console.warn(`[fetcher] 获取 ${repoFullName} events 失败:`, err.message);
    return summaries.join('; ');
  }
}

/**
 * 解析 JSON API 响应
 * @param {string} jsonStr - JSON 字符串
 * @param {string} type - 类型: 'github-repos' 或 'github-issues'
 * @returns {Array} 条目数组
 */
function parseJSON(jsonStr, type) {
  const items = [];
  
  try {
    const data = JSON.parse(jsonStr);
    
    if (type === 'github-repos' && data.items) {
      for (const repo of data.items) {
        let timestamp;
        if (repo.updated_at) {
          timestamp = parseTimestamp(repo.updated_at);
        } else if (repo.pushed_at) {
          timestamp = parseTimestamp(repo.pushed_at);
        } else {
          timestamp = parseTimestamp(null);
        }
        
        items.push({
          title: repo.full_name,
          url: repo.html_url,
          snippet: repo.description || '',
          timestamp,
          _repoFullName: repo.full_name,
        });
      }
    } else if (type === 'github-issues' && data.items) {
      for (const issue of data.items) {
        let timestamp;
        if (issue.updated_at) {
          timestamp = parseTimestamp(issue.updated_at);
        } else if (issue.created_at) {
          timestamp = parseTimestamp(issue.created_at);
        } else {
          timestamp = parseTimestamp(null);
        }
        
        items.push({
          title: issue.title,
          url: issue.html_url,
          snippet: issue.body ? issue.body.substring(0, 300) : '',
          timestamp,
        });
      }
    }
  } catch (error) {
    console.error('[fetcher] JSON 解析错误:', error.message);
  }
  
  return items;
}

/**
 * 构建关键词匹配器（用于全文 RSS feed 过滤）
 * 支持精确匹配和可配置的宽泛匹配模式
 * @param {string} keyword - 关键词
 * @param {string[]} extraPatterns - 额外的正则模式
 * @returns {Function} 匹配函数 (text) => boolean
 */
function buildContentMatcher(keyword, extraPatterns) {
  return configLoader.buildBroadMatcher(keyword, extraPatterns);
}

/**
 * 判断 RSS URL 是否为关键词搜索型（Google News / Bing News）
 * @param {string} url - RSS URL
 * @returns {boolean}
 */
function isSearchRSS(url) {
  return url.includes('news.google.com/rss') || url.includes('bing.com/news/search');
}

/**
 * 从 RSS URL 提取源标识
 * @param {string} url - RSS URL
 * @param {boolean} isSearch - 是否为搜索型 RSS
 * @returns {string} 源标识
 */
function extractRssSource(url, isSearch) {
  if (isSearch) {
    if (url.includes('news.google.com')) {return 'google-news';}
    if (url.includes('bing.com/news')) {return 'bing-news';}
    return 'search-rss';
  }
  try {
    const u = new URL(url);
    return `rss:${  u.hostname.replace(/^www\./, '')}`;
  } catch {
    return 'rss';
  }
}

/**
 * 抓取单个 RSS 源
 * @param {string} rssUrl - RSS URL
 * @param {string} source - 源标识
 * @param {boolean} needsKeywordFilter - 是否需要关键词过滤（通用信息流需要，搜索型 RSS 不需要）
 * @param {string} keyword - 过滤关键词
 * @returns {Promise<Array>} 条目数组
 */
async function fetchRSS(rssUrl, source = 'rss', needsKeywordFilter = false, keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[fetcher] 抓取 RSS [${source}]: ${rssUrl}`);
  
  try {
    const xml = await fetch(rssUrl);
    
    // 自动检测 RSS 类型
    const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');
    const items = parseRSS(xml, isAtom ? 'atom' : 'rss');
    
    // 通用信息流需要过滤：仅保留包含关键词的内容
    const filter = configLoader.getKeywordFilter(kw);
    const matcher = buildContentMatcher(kw, filter.broadPatterns);
    const filteredItems = needsKeywordFilter ? items.filter(i => matcher(`${i.title} ${i.snippet}`)) : items;
    
    if (needsKeywordFilter) {
      console.log(`[fetcher] RSS [${source}] 关键词过滤: ${items.length} → ${filteredItems.length} 条`);
    }
    
    // 统一输出格式，添加访问状态
    return {
      items: filteredItems.map(item => ({
        source,
        source_method: 'rss',
        source_detail: source,
        platform: source,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        timestamp: item.timestamp,
        risk_level: 'pending',
      })),
      rawCount: items.length, // 原始数量（关键词过滤前）
      success: true,
    };
  } catch (error) {
    console.warn(`[fetcher] RSS 抓取失败 [${source}]:`, error.message);
    return {
      items: [],
      rawCount: 0,
      success: false,
      error: error.message,
    };
  }
}

/**
 * 抓取 Google News RSS
 * @param {string} query - 搜索关键词
 * @returns {Promise<Object>} { items: 条目数组, rawCount: 原始数量, success: 是否成功 }
 */
async function fetchGoogleNews(query) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = query || defaultKw;
  // 使用精确匹配: 用引号包裹关键词
  const encodedQuery = encodeURIComponent(`"${  kw  }"`);
  const url = `https://news.google.com/rss?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
  
  console.log(`[fetcher] 抓取 Google News: "${kw}"`);
  
  try {
    const result = await fetchRSS(url, 'google-news', false, kw);
    console.log(`[fetcher] Google News 获取 ${result.items.length} 条`);
    return result;
  } catch (error) {
    console.warn(`[fetcher] Google News 抓取失败:`, error.message);
    return { items: [], rawCount: 0, success: false, error: error.message };
  }
}

/**
 * 抓取 Bing News RSS
 * @param {string} query - 搜索关键词
 * @returns {Promise<Object>} { items: 条目数组, rawCount: 原始数量, success: 是否成功 }
 */
async function fetchBingNews(query) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = query || defaultKw;
  // 使用精确匹配
  const encodedQuery = encodeURIComponent(`"${  kw  }"`);
  const url = `https://www.bing.com/news/search?q=${encodedQuery}&format=rss`;
  
  console.log(`[fetcher] 抓取 Bing News: "${kw}"`);
  
  try {
    const result = await fetchRSS(url, 'bing-news', false, kw);
    console.log(`[fetcher] Bing News 获取 ${result.items.length} 条`);
    return result;
  } catch (error) {
    console.warn(`[fetcher] Bing News 抓取失败:`, error.message);
    return { items: [], rawCount: 0, success: false, error: error.message };
  }
}

/**
 * 抓取 GitHub 搜索结果
 * @param {string} query - 搜索关键词
 * @param {string} type - 类型: 'repositories' 或 'issues'
 * @returns {Promise<Array>} 条目数组
 */
async function fetchGitHub(query, type = 'repositories') {
  const [defaultKw] = configLoader.getKeywords();
  const kw = query || defaultKw;
  // 使用 in:name,in:description 限定搜索范围，提高相关性
  const encodedQuery = encodeURIComponent(`"${kw}" in:name,description`);
  const url = `https://api.github.com/search/${type}?q=${encodedQuery}&sort=updated&order=desc`;
  
  const headers = {};
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `token ${token}`;
  }
  
  console.log(`[fetcher] 抓取 GitHub ${type}: "${kw}"${token ? ' (已认证, 5000次/h)' : ' (匿名, 60次/h)'}`);
  
  try {
    const json = await fetch(url, { timeout: 15000, headers });
    const jsonType = type === 'repositories' ? 'github-repos' : 'github-issues';
    const items = parseJSON(json, jsonType);
    
    // 客户端精确过滤：确保标题或描述中包含精确关键词
    const kwLower = kw.toLowerCase();
    const filtered = items.filter(item => {
      const text = `${item.title} ${item.snippet || ''}`.toLowerCase();
      // 匹配完整关键词（非前缀子串）
      return text.includes(kwLower) && (
        // 后面是边界：空格、-、_、/、) 、结尾 或大写字母（驼峰）
        text.indexOf(kwLower) + kwLower.length >= text.length ||
        /[\s\-_\/\)\]\},.]/.test(text[text.indexOf(kwLower) + kwLower.length]) ||
        /[A-Z]/.test(text[text.indexOf(kwLower) + kwLower.length])
      );
    });
    
    console.log(`[fetcher] GitHub ${type}: API 返回 ${items.length} 条，精确过滤后 ${filtered.length} 条`);
    
    // 对于仓库类型，获取最近活动摘要
    const formattedItems = await Promise.all(filtered.map(async (item) => {
      let snippet = item.snippet || '';
      if (type === 'repositories' && item._repoFullName) {
        const recentActivity = await fetchRepoRecentEvents(item._repoFullName, headers);
        if (recentActivity) {
          snippet = recentActivity;
        }
      }
      return {
        source_method: 'agent_reach',
        source_detail: 'github',
        platform: 'github',
        title: item.title,
        url: item.url,
        snippet,
        timestamp: item.timestamp,
        risk_level: 'pending',
      };
    }));
    
    return formattedItems;
  } catch (error) {
    console.warn(`[fetcher] GitHub ${type} 抓取失败:`, error.message);
    return [];
  }
}

/**
 * 抓取所有配置的 RSS 源
 * @param {Array<string>} rssUrls - RSS URL 列表
 * @param {string} keyword - 过滤关键词
 * @returns {Promise<Object>} { items: 合并后的条目数组, sourceStats: 各源状态 }
 */
async function fetchAllRSS(rssUrls, keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  if (!rssUrls || rssUrls.length === 0) {
    console.log('[fetcher] 未配置 RSS 源');
    return { items: [], sourceStats: {} };
  }
  
  console.log(`[fetcher] 开始抓取 ${rssUrls.length} 个 RSS 源...`);
  
  const allItems = [];
  const seenUrls = new Set();
  const sourceStats = {};
  
  // 并行抓取所有源
  const results = await Promise.allSettled(
    rssUrls.map(async (url, index) => {
      const isSearch = isSearchRSS(url);
      const baseSourceName = extractRssSource(url, isSearch);
      // 为每个 URL 生成唯一的源名称，避免同名源合并
      const sourceName = `${baseSourceName}-${index}`;
      return { sourceName, url, result: await fetchRSS(url, baseSourceName, !isSearch, kw) };
    }),
  );
  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { sourceName, url, result: fetchResult } = result.value;
      
      // 记录源状态（每个 URL 独立记录）
      sourceStats[sourceName] = {
        success: fetchResult.success,
        rawCount: fetchResult.rawCount,
        error: fetchResult.error,
        url: url, // 保存原始 URL 用于显示
      };
      
      // 合并 items
      if (fetchResult.items) {
        for (const item of fetchResult.items) {
          // 去重
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            allItems.push(item);
          }
        }
      }
    } else {
      // Promise rejected
      console.warn('[fetcher] RSS 源抓取异常:', result.reason);
    }
  }
  
  console.log(`[fetcher] RSS 聚合完成，共 ${allItems.length} 条去重后结果`);
  return { items: allItems, sourceStats };
}

/**
 * 聚合所有数据源
 * @param {Object} options - 配置选项
 * @param {Array<string>} options.rssSources - RSS 源列表
 * @param {string} options.keyword - 搜索关键词
 * @param {boolean} options.includeGitHub - 是否包含 GitHub 搜索
 * @returns {Promise<Object>} { items: 合并后的条目数组, stats: 统计信息, sourceStats: 各源状态 }
 */
async function fetchAll(options = {}) {
  const {
    rssSources = [],
    keyword,
    includeGitHub = true,
  } = options;
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  
  console.log('\n📡 开始数据采集...');
  console.log('-'.repeat(50));
  
  const allItems = [];
  const seenUrls = new Set();
  const stats = {
    rss: { success: false, count: 0 },
    googleNews: { success: false, count: 0 },
    bingNews: { success: false, count: 0 },
    githubRepos: { success: false, count: 0 },
    githubIssues: { success: false, count: 0 },
  };
  const sourceStats = {};
  
  // 并行抓取所有源
  const tasks = [];
  
  // RSS 源聚合（搜索型+通用信息流，fetchAllRSS 内部自动区分）
  if (rssSources.length > 0) {
    tasks.push(
      fetchAllRSS(rssSources, kw)
        .then(result => {
          stats.rss.success = true;
          stats.rss.count = result.items.length;
          // 合并 sourceStats
          Object.assign(sourceStats, result.sourceStats);
          return result.items;
        })
        .catch(err => {
          console.warn('[fetcher] RSS 聚合失败:', err.message);
          return [];
        }),
    );
  } else {
    tasks.push(Promise.resolve([]));
  }
  
  // Google News
  tasks.push(
    fetchGoogleNews(kw)
      .then(result => {
        stats.googleNews.success = result.success;
        stats.googleNews.count = result.items.length;
        sourceStats['google-news'] = { 
          success: result.success, 
          rawCount: result.rawCount,
          url: `https://news.google.com/rss?q="${encodeURIComponent(kw)}"&hl=en-US&gl=US&ceid=US:en`
        };
        return result.items;
      })
      .catch(err => {
        console.warn('[fetcher] Google News 失败:', err.message);
        sourceStats['google-news'] = { 
          success: false, 
          rawCount: 0, 
          error: err.message,
          url: `https://news.google.com/rss?q="${encodeURIComponent(kw)}"&hl=en-US&gl=US&ceid=US:en`
        };
        return [];
      }),
  );
  
  // Bing News
  tasks.push(
    fetchBingNews(kw)
      .then(result => {
        stats.bingNews.success = result.success;
        stats.bingNews.count = result.items.length;
        sourceStats['bing-news'] = { 
          success: result.success, 
          rawCount: result.rawCount,
          url: `https://www.bing.com/news/search?q="${encodeURIComponent(kw)}"&format=rss`
        };
        return result.items;
      })
      .catch(err => {
        console.warn('[fetcher] Bing News 失败:', err.message);
        sourceStats['bing-news'] = { 
          success: false, 
          rawCount: 0, 
          error: err.message,
          url: `https://www.bing.com/news/search?q="${encodeURIComponent(kw)}"&format=rss`
        };
        return [];
      }),
  );
  
  // GitHub 搜索
  if (includeGitHub) {
    tasks.push(
      fetchGitHub(kw, 'repositories')
        .then(items => {
          stats.githubRepos.success = true;
          stats.githubRepos.count = items.length;
          return items;
        })
        .catch(err => {
          console.warn('[fetcher] GitHub Repos 失败:', err.message);
          return [];
        }),
    );
    
    tasks.push(
      fetchGitHub(kw, 'issues')
        .then(items => {
          stats.githubIssues.success = true;
          stats.githubIssues.count = items.length;
          return items;
        })
        .catch(err => {
          console.warn('[fetcher] GitHub Issues 失败:', err.message);
          return [];
        }),
    );
  } else {
    tasks.push(Promise.resolve([]));
    tasks.push(Promise.resolve([]));
  }
  
  // 等待所有任务完成
  const results = await Promise.all(tasks);
  
  // 合并去重
  for (const items of results) {
    for (const item of items) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        allItems.push(item);
      }
    }
  }
  
  // 打印采集状态
  console.log('\n📊 数据源采集状态:');
  console.log(`   RSS 聚合:     ${stats.rss.success ? '✅' : '❌'} ${stats.rss.count} 条`);
  console.log(`   Google News:  ${stats.googleNews.success ? '✅' : '❌'} ${stats.googleNews.count} 条`);
  console.log(`   Bing News:    ${stats.bingNews.success ? '✅' : '❌'} ${stats.bingNews.count} 条`);
  console.log(`   GitHub Repos: ${stats.githubRepos.success ? '✅' : '❌'} ${stats.githubRepos.count} 条`);
  console.log(`   GitHub Issues:${stats.githubIssues.success ? '✅' : '❌'} ${stats.githubIssues.count} 条`);
  console.log(`\n   合计: ${allItems.length} 条去重后结果`);
  console.log('-'.repeat(50));
  
  return {
    items: allItems,
    stats,
    sourceStats,
  };
}

module.exports = {
  fetch,
  fetchRSS,
  fetchAllRSS,
  fetchGoogleNews,
  fetchBingNews,
  fetchGitHub,
  fetchAll,
  buildContentMatcher,
  extractRssSource,
  parseRSS,
  parseJSON,
  parseTimestamp,
};