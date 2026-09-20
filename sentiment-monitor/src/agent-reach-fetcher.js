/**
 * agent-reach-fetcher.js - 舆情监控 agent-reach 集成模块
 * 使用 agent-reach CLI 工具从多平台采集数据
 * 零配置渠道:Exa搜索, 小红书, B站, V2EX, RSS, GitHub
 */

const { exec } = require('child_process');
const path = require('path');
const fetcher = require('./fetcher');
const configLoader = require('./configLoader');
const { checkCommand } = require('./cli-tools');

const CLI_PATH = process.env.AGENT_REACH_BIN || '/opt/data/home/.local/bin';

// 工具可用性缓存
const toolAvailability = {};

/**
 * 检查工具是否可用（带缓存）
 * @param {string} tool - 工具名称
 * @returns {Promise<boolean>} 是否可用
 */
async function isToolAvailable(tool) {
  if (toolAvailability[tool] !== undefined) {
    return toolAvailability[tool];
  }
  
  const available = await checkCommand(tool);
  toolAvailability[tool] = available;
  
  if (!available) {
    console.warn(`[agent-reach] 工具 "${tool}" 未安装，相关数据源将被跳过`);
  }
  
  return available;
}

/**
 * Google News 搜索（通过 jina reader 代理，绕过国内网络限制）
 * jina reader 返回 markdown 格式，需解析标题/链接/日期
 * @param {string} keyword - 搜索关键词
 * @param {string} lang - 语言/地区: 'en-US' | 'zh-CN'
 * @returns {Promise<Array>} 结果数组
 */
async function fetchGoogleNewsSearch(keyword, lang = 'en-US') {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  const locale = lang === 'zh-CN' ? 'zh-CN&gl=CN&ceid=CN:zh-Hans' : 'en-US&gl=US&ceid=US:en';
  const encodedQuery = encodeURIComponent(`"${kw}"`);
  const searchUrl = `https://news.google.com/search?q=${encodedQuery}&hl=${locale}`;
  const jinaUrl = `https://r.jina.ai/${searchUrl}`;

  console.log(`[agent-reach] Google News 搜索: "${kw}" (${lang})`);

  try {
    const { stdout } = await execCommand(
      `curl -sL "${jinaUrl}" -H "Accept: text/markdown" -H "User-Agent: ${configLoader.getProjectConfig().userAgent}"`,
      15000,
    );

    if (!stdout || stdout.includes('Just a moment') || stdout.length < 100) {
      console.warn(`[agent-reach] Google News (${lang}) 无有效返回`);
      return [];
    }

    // 提取所有 markdown 链接: [标题](URL)
    // Google News 文章链接格式: [标题](https://news.google.com/read/...)
    const items = [];
    const seenUrls = new Set();
    const lines = stdout.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 匹配 markdown 链接格式: [标题](URL)
      const linkMatch = line.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
      if (!linkMatch) {continue;}

      const title = linkMatch[1].trim();
      const [, , url] = linkMatch;

      // 跳过导航链接和非文章链接
      if (!url.includes('news.google.com/read/') && !url.includes('news.google.com/rss/articles/')) {
        continue;
      }

      // 跳过重复 URL
      if (seenUrls.has(url)) {continue;}
      seenUrls.add(url);

      // 跳过标题过短或明显是导航的链接
      if (title.length < 10 || title.toLowerCase().includes('sign in') || title.toLowerCase() === 'home') {
        continue;
      }

      // 关键词过滤：标题或来源必须包含关键词
      const kwMatcher = configLoader.buildKeywordMatcher(kw);
      const filter = configLoader.getKeywordFilter(kw);
      const broadMatcher = configLoader.buildBroadMatcher(kw, filter.broadPatterns);
      const textToCheck = title.toLowerCase();
      if (!broadMatcher(textToCheck)) {
        continue;
      }

      // 尝试提取来源（在前面的行中找）
      let source = '';
      const SKIP_WORDS = ['more', '展开', 'sign in', '登录', '注册'];
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prevLine = lines[j].trim();
        // 来源通常是单独的文本行，不是链接也不是图片，也不是导航文本
        if (prevLine &&
            !prevLine.startsWith('[') &&
            !prevLine.startsWith('!') &&
            !prevLine.startsWith('#') &&
            prevLine.length < 50 &&
            !prevLine.match(/^\d{4}/) &&
            !SKIP_WORDS.some(w => prevLine.toLowerCase() === w)) {
          source = prevLine;
          break;
        }
      }

      // 尝试提取日期（在后面的行中找）
      let timestamp = new Date().toISOString();
      for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
        const nextLine = lines[j].trim();
        // 英文日期格式: 2 days ago, 1 week ago, Fri, 26 Jun 2026
        // 中文日期格式: 23 小时前, 1 天前, 2 周前
        const dateMatch = nextLine.match(/^([\d]+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|\d+\s+(?:小时|天|周|个月|年)前|\w{3},\s*\d{1,2}\s+\w{3}\s+\d{4})/i);
        if (dateMatch) {
          timestamp = fetcher.parseTimestamp(dateMatch[0]);
          break;
        }
      }

      items.push({
        platform: 'google-news',
        title: source ? `${source}: ${title}` : title,
        url,
        snippet: title,
        timestamp,
        risk_level: 'pending',
        keyword: kw,
      });
    }

    console.log(`[agent-reach] Google News (${lang}) 获取 ${items.length} 条`);
    return items;
  } catch (error) {
    console.warn(`[agent-reach] Google News (${lang}) 搜索失败:`, error.message);
    return [];
  }
}

/**
 * 执行 CLI 命令
 * @param {string} command - 要执行的命令
 * @param {number} timeout - 超时毫秒数
 * @param {string} sourceName - 数据源名称（用于日志）
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execCommand(command, timeout = 15000, sourceName = 'unknown') {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `${CLI_PATH}:${process.env.PATH || ''}` };
    
    console.log(`[agent-reach] 执行命令 [${sourceName}]: ${command.substring(0, 100)}...`);
    
    exec(command, { env, timeout }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ETIMEDOUT') {
          console.error(`[agent-reach] 命令超时 [${sourceName}]: ${command}`);
          reject(new Error(`命令超时: ${command}`));
          return;
        }
        
        // 记录详细错误信息
        console.error(`[agent-reach] 命令执行失败 [${sourceName}]:`, {
          error: error.message,
          code: error.code,
          stderr: stderr?.substring(0, 500),
        });
        
        reject(new Error(`命令失败: ${error.message}`));
        return;
      }
      
      // 记录成功信息
      const outputLength = stdout?.length || 0;
      console.log(`[agent-reach] 命令执行成功 [${sourceName}]: 输出 ${outputLength} 字节`);
      
      resolve({ stdout, stderr });
    });
  });
}

function parseYamlValue(v) {
  if (v === 'true') {return true;}
  if (v === 'false') {return false;}
  if (v === 'null' || v === '~') {return null;}
  return v.replace(/^['"]|['"]$/g, '');
}

function processTopLevelProperty(k, v, state, result) {
  if (state.inArray && state.currentArray.length > 0 && state.currentKey) {
    result[state.currentKey] = state.currentArray;
    state.currentArray = [];
    state.currentObj = null;
    state.inArray = false;
  }

  const parsed = parseYamlValue(v);
  if (parsed === '') {
    state.currentKey = k;
    state.inArray = true;
  } else {
    result[k] = parsed;
    state.currentKey = null;
  }
}

/**
 * 解析 YAML 输出为 JSON
 * agent-reach CLI 返回 YAML 格式
 */
function parseYamlOutput(yamlStr) {
  try {
    // 简易 YAML→JSON 解析(适配 agent-reach 的简单结构)
    const result = {};
    const lines = yamlStr.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    const state = {
      currentKey: null,
      currentArray: [],
      currentObj: null,
      inArray: false,
    };

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '---' || trimmed === '...') {continue;}

      if (trimmed.startsWith('- ')) {
        // 新数组元素开始
        state.inArray = true;
        const rest = trimmed.slice(2).trim();
        if (rest.includes(':')) {
          // - key: value 形式，开始新的数组元素
          state.currentObj = {};
          const colonIdx = rest.indexOf(':');
          const k = rest.slice(0, colonIdx).trim();
          const v = rest.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          state.currentObj[k] = v;
          state.currentArray.push(state.currentObj);
        } else {
          // 纯标量数组元素
          state.currentObj = null;
          state.currentArray.push(rest.replace(/^['"]|['"]$/g, ''));
        }
      } else if (trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const k = trimmed.slice(0, colonIdx).trim();
        const v = trimmed.slice(colonIdx + 1).trim();

        // 判断缩进级别：有缩进 = 属于当前数组元素
        const indent = line.match(/^(\s*)/)[1].length;

        if (state.inArray && indent > 0 && state.currentObj) {
          state.currentObj[k] = parseYamlValue(v);
        } else {
          processTopLevelProperty(k, v, state, result);
        }
      }
    }

    // 收尾
    if (state.inArray && state.currentKey && state.currentArray.length > 0) {
      result[state.currentKey] = state.currentArray;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * 解析 JSON 输出
 */
function parseJsonOutput(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Exa 语义搜索
 * @param {string} keyword - 搜索关键词
 * @param {number} numResults - 结果数量
 * @returns {Promise<Array>} 结果数组
 */
async function fetchExaSearch(keyword, numResults = 10) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] Exa 搜索: "${kw}"`);

  // 检查 mcporter 是否可用
  if (!await isToolAvailable('mcporter')) {
    console.warn('[agent-reach] mcporter 未安装，跳过 Exa 搜索');
    return [];
  }

  try {
    const { stdout, stderr } = await execCommand(
      `mcporter call 'exa.web_search_exa(query: "${kw}", numResults: ${numResults})'`,
      30000,
      'exa'
    );

    // 检测 405/连接错误
    if (stderr && (stderr.includes('405') || stderr.includes('SSE error'))) {
      console.warn('[agent-reach] Exa MCP 服务暂时不可用 (405)，跳过');
      return [];
    }

    const data = parseJsonOutput(stdout);
    if (!data || !data.results) {
      console.warn('[agent-reach] Exa 返回数据格式异常:', stdout?.substring(0, 200));
      return [];
    }

    console.log(`[agent-reach] Exa 搜索获取 ${data.results.length} 条结果`);
    
    return data.results.map(r => ({
      platform: 'exa',
      title: r.title || '',
      url: r.url || '',
      snippet: r.highlights ? r.highlights.join(' ').substring(0, 300) : (r.snippet || ''),
      timestamp: r.published ? fetcher.parseTimestamp(r.published) : fetcher.parseTimestamp(null),
      risk_level: 'pending',
    }));
  } catch (error) {
    console.warn(`[agent-reach] Exa 搜索失败:`, error.message);
    return [];
  }
}

/**
 * LinkedIn 搜索（Jina Reader fallback）
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<Array>} 结果数组
 */
async function fetchLinkedInSearch(keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] LinkedIn 搜索: "${kw}"`);

  try {
    // Jina Reader 对 LinkedIn 有 DDoS 保护，改用 Google News site:linkedin.com
    const googleUrl = `https://news.google.com/rss?q=site%3Alinkedin.com+%22${encodeURIComponent(kw)}%22&hl=en-US&gl=US&ceid=US:en`;
    const { stdout } = await execCommand(
      `curl -sL "${googleUrl}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"`,
      15000,
    );

    if (!stdout || stdout.length < 100) {return [];}

    // 解析 RSS XML
    const items = [];
    const seenUrls = new Set();
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(stdout)) !== null) {
      const [, entry] = match;
      const titleMatch = entry.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = entry.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const pubDateMatch = entry.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i);
      const descMatch = entry.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);

      const title = titleMatch ? titleMatch[1].trim() : '';
      const url = linkMatch ? linkMatch[1].trim() : '';
      if (!title || !url || seenUrls.has(url)) {continue;}
      seenUrls.add(url);

      // 关键词过滤
      const kwMatcher = configLoader.buildKeywordMatcher(kw);
      if (!kwMatcher(title)) {continue;}

      // 解析日期
      let timestamp = fetcher.parseTimestamp(null);
      if (pubDateMatch && pubDateMatch[1]) {
        timestamp = fetcher.parseTimestamp(pubDateMatch[1].trim());
      }

      items.push({
        platform: 'linkedin',
        title,
        url,
        snippet: descMatch ? descMatch[1].trim().replace(/<[^>]+>/g, '').substring(0, 300) : title.substring(0, 300),
        timestamp,
        risk_level: 'pending',
      });
    }

    return items;
  } catch (error) {
    console.warn(`[agent-reach] LinkedIn 搜索失败:`, error.message);
    return [];
  }
}

/**
 * 小红书搜索
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<Array>} 结果数组
 */
async function fetchXhsSearch(keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] 小红书搜索: "${kw}"`);

  // 检查 xhs 是否可用
  if (!await isToolAvailable('xhs')) {
    console.warn('[agent-reach] xhs-cli 未安装，跳过小红书搜索');
    return [];
  }

  try {
    const { stdout } = await execCommand(`xhs search "${kw}"`, 20000, 'xiaohongshu');

    // YAML 输出解析
    const data = parseYamlOutput(stdout);
    if (!data || !data.data || !data.data.items) {
      console.warn('[agent-reach] 小红书返回数据格式异常:', stdout?.substring(0, 200));
      return [];
    }

    const results = data.data.items
      .filter(item => item.note_card)
      .slice(0, 10)
      .map(item => {
        const card = item.note_card;
        const displayTitle = card.display_title || card.title || '';
        const noteId = card.note_id || '';
        return {
          platform: 'xiaohongshu',
          title: displayTitle,
          url: `https://www.xiaohongshu.com/explore/${noteId}`,
          snippet: displayTitle.substring(0, 300),
          timestamp: fetcher.parseTimestamp(null),
          risk_level: 'pending',
        };
      });
    
    console.log(`[agent-reach] 小红书搜索获取 ${results.length} 条结果`);
    return results;
  } catch (error) {
    console.warn(`[agent-reach] 小红书搜索失败:`, error.message);
    return [];
  }
}

/**
 * B站搜索
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<Array>} 结果数组
 */
async function fetchBiliSearch(keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] B站搜索: "${kw}"`);

  // 检查 bili 是否可用
  if (!await isToolAvailable('bili')) {
    console.warn('[agent-reach] bili-cli 未安装，跳过B站搜索');
    return [];
  }

  try {
    const { stdout } = await execCommand(`bili search "${kw}" --type video`, 20000, 'bilibili');
    const data = parseYamlOutput(stdout);
    if (!data || !data.data) {
      console.warn('[agent-reach] B站返回数据格式异常:', stdout?.substring(0, 200));
      return [];
    }
    
    const items = Array.isArray(data.data) ? data.data : [];
    const results = items.slice(0, 10).map(item => {
      // 视频搜索返回 bvid，清理可能的引号
      let bvid = String(item.bvid || item.id || '').replace(/['"]/g, '');
      if (!bvid || !bvid.startsWith('BV')) {return null;}
      const videoUrl = `https://www.bilibili.com/video/${bvid}`;
      
      return {
        platform: 'bilibili',
        title: (item.title || '').replace(/<[^>]+>/g, ''),
        url: videoUrl,
        snippet: (item.description || item.author || '').substring(0, 300),
        timestamp: item.pubdate ? fetcher.parseTimestamp(new Date(item.pubdate * 1000).toISOString()) : fetcher.parseTimestamp(null),
        risk_level: 'pending',
      };
    }).filter(Boolean);
    
    console.log(`[agent-reach] B站搜索获取 ${results.length} 条结果`);
    return results;
  } catch (error) {
    console.warn(`[agent-reach] B站搜索失败:`, error.message);
    return [];
  }
}

/**
 * 微博搜索
 * @param {string} keyword - 搜索关键词
 * @param {number} page - 页码
 * @returns {Promise<Array>} 结果数组
 */
async function fetchWeiboSearch(keyword, page = 1) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] 微博搜索: "${kw}"`);

  // 检查 mcporter 是否可用
  if (!await isToolAvailable('mcporter')) {
    console.warn('[agent-reach] mcporter 未安装，跳过微博搜索');
    return [];
  }

  try {
    const { stdout } = await execCommand(
      `mcporter call 'weibo.search_content(keyword: "${kw}", page: ${page})'`,
      20000,
      'weibo'
    );

    const data = parseJsonOutput(stdout);
    if (!data || !data.result) {
      console.warn('[agent-reach] 微博返回数据格式异常:', stdout?.substring(0, 200));
      return [];
    }

    const results = data.result
      .slice(0, 10)
      .map(item => {
        const text = item.text ? item.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        const username = item.user ? item.user.screen_name : '';
        return {
          platform: 'weibo',
          title: `@${username}: ${text.substring(0, 80)}`,
          url: `https://m.weibo.cn/status/${item.id}`,
          snippet: text.substring(0, 300),
          timestamp: item.created_at ? fetcher.parseTimestamp(item.created_at) : fetcher.parseTimestamp(null),
          risk_level: 'pending',
        };
      });
    
    console.log(`[agent-reach] 微博搜索获取 ${results.length} 条结果`);
    return results;
  } catch (error) {
    console.warn(`[agent-reach] 微博搜索失败:`, error.message);
    return [];
  }
}

/**
 * 百度搜索
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<Array>} 结果数组
 */
async function fetchBaiduSearch(keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] 百度搜索: "${kw}"`);

  try {
    const encodedKeyword = encodeURIComponent(kw);
    const { stdout } = await execCommand(
      `curl -s "https://r.jina.ai/https://www.baidu.com/s?wd=${encodedKeyword}"`,
      15000,
    );

    if (!stdout || stdout.includes('Just a moment')) {return [];}

    // 解析 Jina 返回的 markdown
    const lines = stdout.split('\n');
    const items = [];
    let currentTitle = '';
    let currentUrl = '';
    let currentSnippet = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // 提取 URL
      if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
        if (!trimmed.includes('baidu.com') && !trimmed.includes('baidustatic.com')) {
          currentUrl = trimmed;
        }
      }

      // 提取标题/摘要（包含关键词的行）
      const kwMatcher = configLoader.buildKeywordMatcher(kw);
      const isRelevant = trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('![') && trimmed.length > 20 && kwMatcher(trimmed);
      if (isRelevant) {
        if (!currentTitle) {
          currentTitle = trimmed.substring(0, 100);
        }
        currentSnippet += `${trimmed} `;
      }

      // 尝试提取时间戳
      let timestamp = fetcher.parseTimestamp(null);
      // 查找常见的时间格式
      const dateMatch = currentSnippet.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})|((\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{1,2}))|(\d+\s*(年|月|天|小时|分钟前))/);
      if (dateMatch) {
        timestamp = fetcher.parseTimestamp(dateMatch[0]);
      }

      // 分隔符或空行触发保存
      if ((trimmed === '' || trimmed.startsWith('#')) && currentTitle && currentUrl) {
        items.push({
          platform: 'baidu',
          title: currentTitle,
          url: currentUrl,
          snippet: currentSnippet.substring(0, 300),
          timestamp,
          risk_level: 'pending',
        });
        currentTitle = '';
        currentUrl = '';
        currentSnippet = '';
      }
    }

    // 保存最后一个
    if (currentTitle && currentUrl) {
      // 尝试提取时间戳
      let timestamp = fetcher.parseTimestamp(null);
      const dateMatch = currentSnippet.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})|((\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{1,2}))|(\d+\s*(年|月|天|小时|分钟前))/);
      if (dateMatch) {
        timestamp = fetcher.parseTimestamp(dateMatch[0]);
      }

      items.push({
        platform: 'baidu',
        title: currentTitle,
        url: currentUrl,
        snippet: currentSnippet.substring(0, 300),
        timestamp,
        risk_level: 'pending',
      });
    }

    console.log(`[agent-reach] 百度搜索获取 ${items.length} 条`);
    return items;
  } catch (error) {
    console.warn(`[agent-reach] 百度搜索失败:`, error.message);
    return [];
  }
}

/**
 * V2EX 搜索（用搜索接口替代热门）
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 数量限制
 * @returns {Promise<Array>} 结果数组
 */
async function fetchV2EXHot(keyword, limit = 20) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log(`[agent-reach] V2EX 搜索: "${kw}"`);

  try {
    // 使用 V2EX 搜索 API（通过 Google site 搜索）
    const encodedKeyword = encodeURIComponent(kw);
    const { stdout } = await execCommand(
      `curl -s "https://www.v2ex.com/api/search?q=${encodedKeyword}" -H "User-Agent: agent-reach/1.0"`,
      15000,
    );

    const data = parseJsonOutput(stdout);
    if (!data) {
      // V2EX 搜索 API 可能不存在，回退到热门+关键词过滤
      console.warn(`[agent-reach] V2EX 搜索 API 不可用，改用热门+关键词过滤`);
      return fetchV2EXHotWithFilter(kw, limit);
    }

    let items = Array.isArray(data) ? data : (data.results || []);
    if (!items || !Array.isArray(items)) {return [];}

    return items.slice(0, limit).map(item => ({
      platform: 'v2ex',
      title: item.title || '',
      url: item.url || `https://www.v2ex.com/t/${item.id}`,
      snippet: (item.content || '').substring(0, 300),
      timestamp: item.created ? fetcher.parseTimestamp(new Date(item.created * 1000).toISOString()) : fetcher.parseTimestamp(null),
      risk_level: 'pending',
    }));
  } catch (error) {
    console.warn(`[agent-reach] V2EX 搜索失败:`, error.message);
    // 回退到热门+过滤
    return fetchV2EXHotWithFilter(kw, limit);
  }
}

/**
 * V2EX 热门话题 + 关键词过滤（备用方案）
 */
async function fetchV2EXHotWithFilter(keyword, limit = 20) {
  try {
    const { stdout } = await execCommand(
      `curl -s "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: agent-reach/1.0"`,
      15000,
    );

    const data = parseJsonOutput(stdout);
    if (!data || !Array.isArray(data)) {return [];}

    const kw = keyword.toLowerCase();
    return data
      .filter(item => {
        const text = `${item.title || ''} ${item.content || ''}`.toLowerCase();
        return text.includes(kw);
      })
      .slice(0, limit)
      .map(item => ({
        platform: 'v2ex',
        title: item.title || '',
        url: item.url || `https://www.v2ex.com/t/${item.id}`,
        snippet: (item.content || '').substring(0, 300),
        timestamp: item.created ? fetcher.parseTimestamp(new Date(item.created * 1000).toISOString()) : fetcher.parseTimestamp(null),
        risk_level: 'pending',
      }));
  } catch (error) {
    console.warn(`[agent-reach] V2EX 热门获取失败:`, error.message);
    return [];
  }
}

/**
 * 聚合所有 agent-reach 数据源
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<{items: Array, stats: Object}>}
 */
async function fetchAllAgentReach(keyword) {
  const [defaultKw] = configLoader.getKeywords();
  const kw = keyword || defaultKw;
  console.log('\n📡 开始 agent-reach 数据采集...');
  console.log('-'.repeat(50));

  // 检查工具可用性
  console.log('[agent-reach] 检查 CLI 工具可用性...');
  await Promise.all([
    isToolAvailable('mcporter'),
    isToolAvailable('xhs'),
    isToolAvailable('bili'),
  ]);

  const stats = {
    exa: { success: false, count: 0 },
    xiaohongshu: { success: false, count: 0 },
    bilibili: { success: false, count: 0 },
    weibo: { success: false, count: 0 },
    v2ex: { success: false, count: 0 },
    baidu: { success: false, count: 0 },
    'google-news': { success: false, count: 0 },
    linkedin: { success: false, count: 0 },
  };

  // 并行执行所有数据源
  // Google News 已通过 RSS fetcher 获取（有正确的 pubDate），这里禁用 agent-reach 的 Google News
  const [exaResults, xhsResults, biliResults, weiboResults, v2exResults, baiduResults, linkedinResults] = await Promise.all([
    fetchExaSearch(kw, 10).then(r => { stats.exa.success = true; stats.exa.count = r.length; return r; }),
    fetchXhsSearch(kw).then(r => { stats.xiaohongshu.success = true; stats.xiaohongshu.count = r.length; return r; }),
    fetchBiliSearch(kw).then(r => { stats.bilibili.success = true; stats.bilibili.count = r.length; return r; }),
    fetchWeiboSearch(kw).then(r => { stats.weibo.success = true; stats.weibo.count = r.length; return r; }),
    fetchV2EXHot(kw, 20).then(r => { stats.v2ex.success = true; stats.v2ex.count = r.length; return r; }),
    fetchBaiduSearch(kw).then(r => { stats.baidu.success = true; stats.baidu.count = r.length; return r; }),
    fetchLinkedInSearch(kw).then(r => { stats.linkedin.success = true; stats.linkedin.count = r.length; return r; }),
  ]);
  
  // Google News 通过 RSS fetcher 处理，此处返回空
  const googleNewsEnResults = [];
  const googleNewsZhResults = [];
  stats['google-news'].success = true;
  stats['google-news'].count = 0;

  // 合并去重
  const allItems = [];
  const seenUrls = new Set();

  for (const items of [exaResults, xhsResults, biliResults, weiboResults, v2exResults, baiduResults, linkedinResults, googleNewsEnResults, googleNewsZhResults]) {
    for (const item of items) {
      if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        allItems.push(item);
      }
    }
  }

  console.log('\n📊 agent-reach 数据源采集状态:');
  console.log(`   Exa搜索:      ${stats.exa.success ? '✅' : '❌'} ${stats.exa.count} 条`);
  console.log(`   小红书:        ${stats.xiaohongshu.success ? '✅' : '❌'} ${stats.xiaohongshu.count} 条`);
  console.log(`   B站:          ${stats.bilibili.success ? '✅' : '❌'} ${stats.bilibili.count} 条`);
  console.log(`   微博搜索:      ${stats.weibo.success ? '✅' : '❌'} ${stats.weibo.count} 条`);
  console.log(`   V2EX:         ${stats.v2ex.success ? '✅' : '❌'} ${stats.v2ex.count} 条`);
  console.log(`   百度:         ${stats.baidu.success ? '✅' : '❌'} ${stats.baidu.count} 条`);
  console.log(`   Google News:  ${stats['google-news'].success ? '✅' : '❌'} ${stats['google-news'].count} 条`);
  console.log(`   LinkedIn:     ${stats.linkedin.success ? '✅' : '❌'} ${stats.linkedin.count} 条`);
  console.log(`\n   合计: ${allItems.length} 条去重后结果`);
  console.log('-'.repeat(50));

  return { items: allItems, stats };
}

module.exports = {
  fetchExaSearch,
  fetchXhsSearch,
  fetchBiliSearch,
  fetchWeiboSearch,
  fetchV2EXHot,
  fetchBaiduSearch,
  fetchLinkedInSearch,
  fetchGoogleNewsSearch,
  fetchAllAgentReach,
  parseYamlOutput,
  parseJsonOutput,
};
