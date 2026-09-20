const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv optional
}

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

const DEFAULT_PROJECT = {
  name: 'sentiment-monitor',
  displayName: '舆情监控',
  description: '每日检索并分析相关舆情内容',
  userAgent: 'SentimentMonitor/1.0',
  timezone: 'Asia/Shanghai',
  defaultKeywords: ['YourKeyword'],
  emailFrom: 'Monitor <noreply@example.com>',
  emailSubject: '{displayName} 舆情日报 — {date}',
  reportTitle: '📋 {displayName} 舆情监控日报',
  pdfFilename: '{name}-report-{date}.pdf',
};

let _configCache = null;
let _currentProfile = null;

/**
 * 替换配置中的环境变量占位符 ${VAR_NAME}
 * @param {*} value - 配置值
 * @returns {*} 替换后的值
 */
function substituteEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (match, varName) => {
      return process.env[varName] || match;
    });
  }
  if (Array.isArray(value)) {
    return value.map(substituteEnvVars);
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = substituteEnvVars(v);
    }
    return result;
  }
  return value;
}

/**
 * 设置当前 profile
 * @param {string} profile - profile 名称
 */
function setProfile(profile) {
  _currentProfile = profile;
  _configCache = null; // 清除缓存，重新加载
}

/**
 * 获取当前 profile
 * @returns {string|null}
 */
function getProfile() {
  return _currentProfile;
}

/**
 * 获取配置文件路径
 * @returns {string}
 */
function getConfigPath() {
  if (_currentProfile) {
    const profilePath = path.join(CONFIG_DIR, `${_currentProfile}.json`);
    if (fs.existsSync(profilePath)) {
      return profilePath;
    }
    console.warn(`[configLoader] Profile "${_currentProfile}" 配置文件不存在，使用默认 config.json`);
  }
  return CONFIG_PATH;
}

function loadConfig() {
  if (_configCache) {return _configCache;}
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      _configCache = substituteEnvVars(raw);
      if (_currentProfile) {
        console.log(`[configLoader] 使用 profile: ${_currentProfile} (${configPath})`);
      }
      return _configCache;
    }
  } catch (err) {
    console.warn('[configLoader] Failed to load config:', err.message);
  }
  return {};
}

function getProjectConfig() {
  const config = loadConfig();
  return { ...DEFAULT_PROJECT, ...(config.project || {}) };
}

function getKeywords() {
  // 优先从环境变量 KEYWORDS 读取（逗号分隔）
  if (process.env.KEYWORDS) {
    return process.env.KEYWORDS.split(',').map(k => k.trim()).filter(Boolean);
  }
  
  const config = loadConfig();
  const proj = getProjectConfig();
  return config.keywords || proj.defaultKeywords;
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] != null ? String(vars[key]) : '');
}

/**
 * 获取关键词配置（所有关键词共享）
 * @returns {Object} { daysBack, todayOnly }
 */
function getKeywordConfig() {
  const config = loadConfig();
  return config.keywordConfig || { daysBack: 3, todayOnly: false };
}

/**
 * 获取搜索变体（替换 {keyword} 模板）
 * @param {string} keyword - 关键词
 * @returns {string[]} 搜索变体数组
 */
function getSearchVariants(keyword) {
  const config = loadConfig();
  const variants = config.searchVariants;
  
  // 新格式：数组，使用 {keyword} 模板
  if (Array.isArray(variants)) {
    return variants.map(v => renderTemplate(v, { keyword }));
  }
  
  // 旧格式：按关键词分组的对象
  if (variants && variants[keyword]) {
    return variants[keyword];
  }
  
  // 默认
  return [keyword, `"${keyword}"`];
}

/**
 * 获取 RSS 源（替换 {keyword} 模板）
 * @param {string} keyword - 关键词
 * @returns {string[]} RSS 源 URL 数组
 */
function getRssSources(keyword) {
  const config = loadConfig();
  const sources = config.rssSources;
  
  // 新格式：数组，使用 {keyword} 模板
  if (Array.isArray(sources)) {
    return sources.map(s => renderTemplate(s, { keyword }));
  }
  
  // 旧格式：按关键词分组的对象
  if (sources && sources[keyword]) {
    return sources[keyword];
  }
  
  // 默认
  return [];
}

function getKeywordFilter(keyword) {
  const config = loadConfig();
  return config.keywordFilter?.[keyword] || { exactPatterns: [], broadPatterns: [] };
}

function buildKeywordMatcher(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  return (text) => regex.test(text);
}

function buildBroadMatcher(keyword, extraPatterns) {
  const exactMatch = buildKeywordMatcher(keyword);
  
  // 排除词列表 - 如果文章包含这些词，即使包含关键词也不匹配
  const excludePatterns = [
    /openai/i,  // 排除 OpenAI 相关内容
    /open\s*an(?:d|other)/i,  // 排除 "open an" 这种短语
  ];
  
  if (!extraPatterns || extraPatterns.length === 0) {
    return (text) => {
      // 先检查是否包含排除词
      if (excludePatterns.some(pattern => pattern.test(text))) {
        return false;
      }
      // 然后检查精确匹配
      if (exactMatch(text)) {return true;}
      // 最后检查简单包含（但要求更严格的边界）
      const lowerText = (text || '').toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      const index = lowerText.indexOf(lowerKeyword);
      if (index === -1) return false;
      
      // 检查关键词前后的字符，确保是完整的词
      const before = index > 0 ? lowerText[index - 1] : ' ';
      const after = lowerText[index + lowerKeyword.length] || ' ';
      const isWordBoundary = /[\s\-\_\/\.\,\;\:\!\?\(\)\[\]\{\}\"\']/.test(before) && 
                             /[\s\-\_\/\.\,\;\:\!\?\(\)\[\]\{\}\"\']/.test(after);
      return isWordBoundary;
    };
  }
  const broadRegexes = extraPatterns.map(p => new RegExp(p, 'i'));
  return (text) => {
    // 先检查是否包含排除词
    if (excludePatterns.some(pattern => pattern.test(text))) {
      return false;
    }
    if (exactMatch(text)) {return true;}
    return broadRegexes.some(rx => rx.test(text));
  };
}

function resetCache() {
  _configCache = null;
}

module.exports = {
  loadConfig,
  getProjectConfig,
  getKeywords,
  getKeywordConfig,
  getSearchVariants,
  getRssSources,
  renderTemplate,
  getKeywordFilter,
  buildKeywordMatcher,
  buildBroadMatcher,
  setProfile,
  getProfile,
  getConfigPath,
  resetCache,
};
