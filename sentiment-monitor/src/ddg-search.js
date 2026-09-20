/**
 * ddg-search.js - 内置 DuckDuckGo HTML 搜索模块
 * 替代外部 agent 的 web_search，直接搜索国内技术社区
 */

const https = require('https');
const http = require('http');
const configLoader = require('./configLoader');

// 超时控制（毫秒）
const SEARCH_TIMEOUT = 15000;

// 默认搜索站点列表
const DEFAULT_SITES = [
  { key: 'csdn', label: 'CSDN', domain: 'csdn.net' },
  { key: 'zhihu', label: '知乎', domain: 'zhihu.com' },
  { key: 'juejin', label: '掘金', domain: 'juejin.cn' },
  { key: 'cnblogs', label: '博客园', domain: 'cnblogs.com' },
  { key: 'segmentfault', label: '思否', domain: 'segmentfault.com' },
  { key: 'toutiao', label: '头条', domain: 'toutiao.com' },
  { key: 'oschina', label: '开源中国', domain: 'oschina.net' },
  { key: 'infoq', label: 'InfoQ', domain: 'infoq.cn' },
];

/**
 * 执行 DuckDuckGo HTML 搜索
 * @param {string} query - 搜索查询
 * @returns {Promise<Array>} 搜索结果数组
 */
function searchDuckDuckGo(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    // 尝试使用 lite 版本
    const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;
    
    const options = {
      hostname: 'lite.duckduckgo.com',
      port: 443,
      path: `/lite/?q=${encodedQuery}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: SEARCH_TIMEOUT,
    };

    const req = https.request(options, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        searchDuckDuckGo(query).then(resolve).catch(reject);
        return;
      }

      // 处理 202 状态码（DuckDuckGo 反爬虫）
      if (res.statusCode === 202) {
        console.warn(`[ddg-search] DuckDuckGo 返回 202，可能被限流: ${query}`);
        resolve([]); // 返回空结果而不是报错
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const results = parseDuckDuckGoResults(body);
          resolve(results);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });

    req.end();
  });
}

/**
 * 解析 DuckDuckGo HTML 搜索结果
 * @param {string} html - HTML 内容
 * @returns {Array} 解析后的结果数组
 */
function parseDuckDuckGoResults(html) {
  const results = [];
  
  // 匹配结果块: <div class="result...">...</div>
  // DuckDuckGo HTML 版本的结果通常在 <div class="result"> 或 <div class="web-result"> 中
  const resultRegex = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*result|$)/gi;
  let match;
  
  while ((match = resultRegex.exec(html)) !== null) {
    const block = match[1];
    
    // 提取标题和链接
    // 通常在 <a class="result__a" href="...">标题</a>
    const titleMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) {continue;}
    
    const url = decodeDuckDuckGoUrl(titleMatch[1]);
    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
    
    // 提取摘要
    // 通常在 <a class="result__snippet">摘要</a>
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    
    if (title && url) {
      results.push({ title, url, snippet });
    }
  }
  
  // 备用解析：如果上面的正则没匹配到，尝试更宽松的匹配
  if (results.length === 0) {
    const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seenUrls = new Set();
    
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      
      // 跳过 DuckDuckGo 自己的链接
      if (url.includes('duckduckgo.com') || seenUrls.has(url)) {continue;}
      if (title.length < 10) {continue;}
      
      seenUrls.add(url);
      results.push({ title, url, snippet: '' });
      
      if (results.length >= 20) {break;}
    }
  }
  
  return results;
}

/**
 * 解码 DuckDuckGo 重定向 URL
 * DuckDuckGo 的链接通常是重定向格式: //duckduckgo.com/l/?uddg=实际URL
 * @param {string} url - DuckDuckGo URL
 * @returns {string} 实际 URL
 */
function decodeDuckDuckGoUrl(url) {
  if (url.includes('duckduckgo.com/l/')) {
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]);
    }
  }
  return url;
}

/**
 * 识别 URL 对应的平台
 * @param {string} url - URL
 * @returns {string} 平台标识
 */
function identifyPlatform(url) {
  const urlLower = url.toLowerCase();
  
  for (const site of DEFAULT_SITES) {
    if (urlLower.includes(site.domain)) {
      return site.key;
    }
  }
  
  // 其他常见平台
  if (urlLower.includes('weixin.qq.com') || urlLower.includes('mp.weixin')) {return 'weixin';}
  if (urlLower.includes('bilibili.com')) {return 'bilibili';}
  if (urlLower.includes('weibo.com')) {return 'weibo';}
  if (urlLower.includes('xiaohongshu.com')) {return 'xiaohongshu';}
  if (urlLower.includes('v2ex.com')) {return 'v2ex';}
  if (urlLower.includes('github.com')) {return 'github';}
  
  return 'other';
}

/**
 * 搜索单个站点
 * @param {string} keyword - 关键词
 * @param {Object} site - 站点配置 { key, label, domain }
 * @returns {Promise<Array>} 搜索结果数组
 */
async function searchSite(keyword, site) {
  const query = `site:${site.domain} "${keyword}"`;
  console.log(`[ddg-search] 搜索 ${site.label}: ${query}`);
  
  try {
    const results = await searchDuckDuckGo(query);
    console.log(`[ddg-search] ${site.label}: 获取 ${results.length} 条`);
    
    return results.map(r => ({
      platform: site.key,
      source_method: 'web_search',
      source_detail: site.key,
      title: r.title,
      url: r.url,
      snippet: r.snippet || r.title.substring(0, 200),
      timestamp: new Date().toISOString(), // 搜索时间作为临时时间
      risk_level: 'pending',
      _needsTimeExtraction: true, // 标记需要时间提取
    }));
  } catch (err) {
    console.warn(`[ddg-search] ${site.label} 搜索失败:`, err.message);
    return [];
  }
}

/**
 * 搜索所有配置的站点
 * @param {string} keyword - 关键词
 * @param {Array} sites - 站点列表（可选，默认使用 DEFAULT_SITES）
 * @returns {Promise<Array>} 合并后的搜索结果
 */
async function searchAllSites(keyword, sites = null) {
  const targetSites = sites || DEFAULT_SITES;
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  
  console.log(`\n[ddg-search] 开始搜索 ${targetSites.length} 个站点...`);
  console.log('-'.repeat(50));
  
  // 并行搜索（限制并发避免限流）
  const CONCURRENT_LIMIT = 3;
  const allResults = [];
  const seenUrls = new Set();
  
  for (let i = 0; i < targetSites.length; i += CONCURRENT_LIMIT) {
    const batch = targetSites.slice(i, i + CONCURRENT_LIMIT);
    
    const batchResults = await Promise.all(
      batch.map(site => searchSite(kw, site))
    );
    
    for (const results of batchResults) {
      for (const item of results) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allResults.push(item);
        }
      }
    }
    
    // 批次间延迟，避免限流
    if (i + CONCURRENT_LIMIT < targetSites.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log('-'.repeat(50));
  console.log(`[ddg-search] 搜索完成，共 ${allResults.length} 条去重后结果`);
  
  return allResults;
}

module.exports = {
  searchDuckDuckGo,
  searchSite,
  searchAllSites,
  identifyPlatform,
  parseDuckDuckGoResults,
  decodeDuckDuckGoUrl,
  DEFAULT_SITES,
};
