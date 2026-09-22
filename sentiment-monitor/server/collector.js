/**
 * collector.js - 数据采集服务
 * 封装采集逻辑，供 scheduler 调用
 */

const fetcher = require('../src/fetcher');
const agentReachFetcher = require('../src/agent-reach-fetcher');
const ddgSearch = require('../src/ddg-search');
const { getDb } = require('./db');
const logger = require('./logger');
const relevanceChecker = require('./relevanceChecker');

/**
 * 替换模板变量
 * @param {string} template - 模板字符串
 * @param {string} keyword - 关键词
 * @returns {string} 替换后的字符串
 */
function renderTemplate(template, keyword) {
  return template.replace(/\{keyword\}/g, keyword);
}

/**
 * 从 RSS URL 中提取源名称（与 fetcher.js 的 extractRssSource 保持一致）
 * @param {string} url - RSS URL
 * @returns {string} 源名称
 */
function extractSourceName(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    
    // 特殊处理常见的搜索型 RSS 源
    if (url.includes('news.google.com')) return 'google-news';
    if (url.includes('bing.com/news')) return 'bing-news';
    
    // 其他 RSS 源返回 rss:hostname 格式
    return `rss:${hostname}`;
  } catch (e) {
    return 'rss';
  }
}

/**
 * 过滤时间范围内的数据
 * @param {Array} items - 数据项数组
 * @param {number} daysBack - 回溯天数
 * @returns {Array} 过滤后的数据
 */
function filterByTime(items, daysBack) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  
  return items.filter(item => {
    if (!item.timestamp) return true; // 没有时间戳的保留
    
    const itemTime = new Date(item.timestamp).getTime();
    if (isNaN(itemTime)) return true; // 无法解析的保留
    
    return itemTime >= cutoff;
  });
}

/**
 * 执行数据采集
 * @param {Object} project - 项目对象
 * @param {string} triggerType - 触发类型：manual/scheduled
 * @returns {Promise<Object>} 采集结果
 */
async function collect(project, triggerType = 'scheduled') {
  const db = getDb();
  const config = JSON.parse(project.config);
  const keywords = config.keywords || [];
  
  if (keywords.length === 0) {
    throw new Error('项目未配置关键词');
  }
  
  const keyword = keywords[0]; // 暂时只支持第一个关键词
  const date = new Date().toISOString().split('T')[0];
  const daysBack = config.keywordConfig?.daysBack || 3;
  
  logger.info('开始数据采集', { projectId: project.id, keyword, date, daysBack });
  
  // 创建采集记录
  const insertStmt = db.prepare(`
    INSERT INTO collection_history (project_id, trigger_type, status, started_at)
    VALUES (?, ?, 'running', CURRENT_TIMESTAMP)
  `);
  const result = insertStmt.run(project.id, triggerType);
  const historyId = result.lastInsertRowid;
  
  // 健康度统计
  const sourceStats = {};
  
  // 辅助函数：初始化源统计
  function initSourceStats(source, link = null, sourceType = 'unknown') {
    if (!sourceStats[source]) {
      sourceStats[source] = { raw: 0, filtered: 0, link: link, sourceType: sourceType };
    } else {
      if (link && !sourceStats[source].link) {
        // 如果已有记录但没有链接，更新链接
        sourceStats[source].link = link;
      }
      // 更新 sourceType
      sourceStats[source].sourceType = sourceType;
    }
  }
  
  try {
    let totalItems = 0;
    
    // 1. RSS/API 采集
    try {
      // 替换模板变量
      const rssSources = (config.rssSources || []).map(url => renderTemplate(url, keyword));
      
      // 创建源名称到 URL 的映射表，并初始化所有源
      // 每个 URL 都有唯一的索引，避免同名源合并
      const sourceUrlMap = {};
      for (let i = 0; i < rssSources.length; i++) {
        const url = rssSources[i];
        // 使用 fetcher.js 的 extractRssSource 逻辑来匹配源名称
        let baseSourceName;
        if (url.includes('news.google.com')) {
          baseSourceName = 'google-news';
        } else if (url.includes('bing.com/news')) {
          baseSourceName = 'bing-news';
        } else {
          try {
            const u = new URL(url);
            baseSourceName = `rss:${u.hostname.replace(/^www\./, '')}`;
          } catch {
            baseSourceName = 'rss';
          }
        }
        // 为每个 URL 生成唯一的源名称
        const sourceName = `${baseSourceName}-${i}`;
        sourceUrlMap[sourceName] = url;
        // 初始化所有配置的源，即使没有数据也会记录
        initSourceStats(sourceName, url, 'rss');
      }
      
      const rssResult = await fetcher.fetchAll({
        rssSources: rssSources,
        keyword: keyword,
        includeGitHub: true
      });
      
      if (rssResult) {
        // 使用 fetcher 返回的 sourceStats 更新源状态
        if (rssResult.sourceStats) {
          for (const [sourceName, sourceInfo] of Object.entries(rssResult.sourceStats)) {
            // 使用 fetcher 返回的 URL，如果没有则使用映射表中的 URL
            const url = sourceInfo.url || sourceUrlMap[sourceName];
            initSourceStats(sourceName, url, 'rss');
            sourceStats[sourceName].success = sourceInfo.success;
            sourceStats[sourceName].raw = sourceInfo.rawCount || 0;
            if (sourceInfo.error) {
              sourceStats[sourceName].error = sourceInfo.error;
            }
          }
        }
        
        const rawCount = rssResult.items ? rssResult.items.length : 0;
        
        // 时间过滤
        const beforeTimeFilter = rssResult.items || [];
        let filteredItems = filterByTime(beforeTimeFilter, daysBack);
        const afterTimeFilter = filteredItems.length;
        
        logger.info('RSS 时间过滤', { 
          before: beforeTimeFilter.length, 
          after: afterTimeFilter, 
          daysBack,
          filteredOut: beforeTimeFilter.length - afterTimeFilter
        });
        
        // 相关性过滤（使用 LLM）
        const beforeRelevanceFilter = filteredItems;
        filteredItems = await relevanceChecker.filterByRelevance(filteredItems, keyword);
        const afterRelevanceFilter = filteredItems.length;
        
        logger.info('RSS 相关性过滤', { 
          before: beforeRelevanceFilter.length, 
          after: afterRelevanceFilter,
          filteredOut: beforeRelevanceFilter.length - afterRelevanceFilter
        });
        
        const filteredCount = filteredItems.length;
        
        // 重新统计各源最终过滤后的数据（基于最终保存的数据）
        for (const [sourceName] of Object.entries(sourceStats)) {
          if (sourceStats[sourceName]) {
            sourceStats[sourceName].filtered = 0; // 重置
          }
        }
        for (const item of filteredItems) {
          const source = item.source || 'rss';
          if (sourceStats[source]) {
            sourceStats[source].filtered = (sourceStats[source].filtered || 0) + 1;
          }
        }
        
        logger.info('RSS 采集完成', { rawCount, filteredCount, daysBack });
        
        // 保存采集结果到数据库
        const insertItem = db.prepare(`
          INSERT OR IGNORE INTO items (project_id, collection_id, source, source_type, title, url, snippet, timestamp, risk_level, sentiment, status)
          VALUES (?, ?, ?, 'rss', ?, ?, ?, ?, ?, ?, 'pending')
        `);
        
        for (const item of filteredItems) {
          try {
            insertItem.run(
              project.id,
              historyId,
              item.source || item.platform || 'unknown',
              item.title || '',
              item.url || '',
              item.snippet || '',
              item.timestamp || new Date().toISOString(),
              item.risk_level || 'low',
              item.sentiment || 'neutral'
            );
            totalItems++;
          } catch (err) {
            logger.warn('保存采集项失败', { error: err.message, item: item.title });
          }
        }
      }
    } catch (err) {
      logger.error('RSS/API 采集失败', err);
    }
    
    // 2. Agent-Reach 采集
    try {
      // 定义 agent-reach 源的链接映射
      const agentReachLinks = {
        'exa': 'https://exa.ai',
        'xiaohongshu': 'https://www.xiaohongshu.com',
        'bilibili': 'https://www.bilibili.com',
        'weibo': 'https://weibo.com',
        'v2ex': 'https://www.v2ex.com',
        'baidu': 'https://www.baidu.com',
        'linkedin': 'https://www.linkedin.com',
      };
      
      // 初始化所有 agent-reach 源
      for (const [source, link] of Object.entries(agentReachLinks)) {
        initSourceStats(source, link, 'agent-reach');
      }
      
      const agentReachResult = await agentReachFetcher.fetchAllAgentReach(keyword);
      
      if (agentReachResult && agentReachResult.items) {
        const rawCount = agentReachResult.items.length;
        
        // 统计各源原始数据
        for (const item of agentReachResult.items) {
          const source = item.platform || 'agent-reach';
          initSourceStats(source, agentReachLinks[source] || null, 'agent-reach');
          sourceStats[source].raw++;
        }
        
        // 时间过滤
        let filteredItems = filterByTime(agentReachResult.items, daysBack);
        
        // 相关性过滤（使用 LLM）
        filteredItems = await relevanceChecker.filterByRelevance(filteredItems, keyword);
        
        const filteredCount = filteredItems.length;
        
        logger.info('Agent-Reach 采集', { rawCount, filteredCount, daysBack });
        
        // 统计各源过滤后数据
        for (const item of filteredItems) {
          const source = item.platform || 'agent-reach';
          sourceStats[source].filtered++;
        }
        
        const insertItem = db.prepare(`
          INSERT OR IGNORE INTO items (project_id, collection_id, source, source_type, title, url, snippet, timestamp, risk_level, sentiment, status)
          VALUES (?, ?, ?, 'agent-reach', ?, ?, ?, ?, ?, ?, 'pending')
        `);
        
        for (const item of filteredItems) {
          try {
            insertItem.run(
              project.id,
              historyId,
              item.platform || 'agent-reach',
              item.title || '',
              item.url || '',
              item.snippet || '',
              item.timestamp || new Date().toISOString(),
              item.risk_level || 'low',
              item.sentiment || 'neutral'
            );
            totalItems++;
          } catch (err) {
            logger.warn('保存采集项失败', { error: err.message, item: item.title });
          }
        }
      }
    } catch (err) {
      logger.error('Agent-Reach 采集失败', err);
    }
    
    // 3. DuckDuckGo 搜索
    try {
      // 定义 DuckDuckGo 搜索源的链接映射
      const ddgLinks = {
        'csdn': 'https://www.csdn.net',
        'zhihu': 'https://www.zhihu.com',
        'juejin': 'https://juejin.cn',
        'cnblogs': 'https://www.cnblogs.com',
        'segmentfault': 'https://segmentfault.com',
        'toutiao': 'https://www.toutiao.com',
        'oschina': 'https://www.oschina.net',
        'infoq': 'https://www.infoq.cn',
      };
      
      // 初始化所有 DuckDuckGo 源
      for (const [source, link] of Object.entries(ddgLinks)) {
        initSourceStats(source, link, 'duckduckgo');
      }
      
      const ddgResult = await ddgSearch.searchAllSites(keyword);
      
      if (ddgResult && ddgResult.length > 0) {
        const rawCount = ddgResult.length;
        
        // 统计各源原始数据
        for (const item of ddgResult) {
          const source = item.platform || 'duckduckgo';
          initSourceStats(source, ddgLinks[source] || null, 'duckduckgo');
          sourceStats[source].raw++;
        }
        
        // 时间提取：对需要时间提取的条目进行时间提取
        logger.info('DuckDuckGo 时间提取', { count: ddgResult.length });
        for (const item of ddgResult) {
          if (item._needsTimeExtraction) {
            try {
              const timeExtractor = require('../src/timeExtractor');
              const result = await timeExtractor.extract({
                item,
                fallbackDate: date,
                url: item.url,
              });
              item.timestamp = result.timestamp;
              item._timeEstimated = result.estimated;
              item._timeMethod = result.method;
            } catch (err) {
              logger.warn('时间提取失败', { url: item.url, error: err.message });
              // 保持原有的临时时间
            }
          }
        }
        
        // 时间过滤
        let filteredItems = filterByTime(ddgResult, daysBack);
        
        // 相关性过滤（使用 LLM）
        filteredItems = await relevanceChecker.filterByRelevance(filteredItems, keyword);
        
        const filteredCount = filteredItems.length;
        
        logger.info('DuckDuckGo 采集', { rawCount, filteredCount, daysBack });
        
        // 统计各源过滤后数据
        for (const item of filteredItems) {
          const source = item.platform || 'duckduckgo';
          sourceStats[source].filtered++;
        }
        
        const insertItem = db.prepare(`
          INSERT OR IGNORE INTO items (project_id, collection_id, source, source_type, title, url, snippet, timestamp, risk_level, sentiment, status)
          VALUES (?, ?, ?, 'duckduckgo', ?, ?, ?, ?, ?, ?, 'pending')
        `);
        
        for (const item of filteredItems) {
          try {
            insertItem.run(
              project.id,
              historyId,
              item.platform || 'duckduckgo',
              item.title || '',
              item.url || '',
              item.snippet || '',
              item.timestamp || new Date().toISOString(),
              item.risk_level || 'low',
              item.sentiment || 'neutral'
            );
            totalItems++;
          } catch (err) {
            logger.warn('保存采集项失败', { error: err.message, item: item.title });
          }
        }
      }
    } catch (err) {
      logger.error('DuckDuckGo 搜索失败', err);
    }
    
    // 写入健康度数据
    const insertHealth = db.prepare(`
      INSERT INTO source_health (project_id, source, link, source_type, date, raw_count, filtered_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const [source, stats] of Object.entries(sourceStats)) {
      // 根据源是否成功访问来判断异常
      // 如果源访问失败（success = false），标记为异常
      // 如果源访问成功但 filtered_count = 0，标记为正常（只是没有相关内容）
      const status = stats.success === false ? 'anomaly' : 'normal';
      
      try {
        insertHealth.run(
          project.id,
          source,
          stats.link || null,
          stats.sourceType || 'unknown',
          date,
          stats.raw || 0,
          stats.filtered || 0,
          status
        );
      } catch (err) {
        logger.warn('写入健康度数据失败', { source, error: err.message });
      }
    }
    
    // 更新采集记录
    db.prepare(`
      UPDATE collection_history 
      SET status = 'success', items_count = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalItems, historyId);
    
    logger.info('数据采集完成', { projectId: project.id, totalItems, sources: Object.keys(sourceStats).length });
    
    return {
      success: true,
      historyId,
      itemsCount: totalItems,
      projectId: project.id,
      projectName: project.name
    };
    
  } catch (error) {
    // 更新失败记录
    db.prepare(`
      UPDATE collection_history 
      SET status = 'error', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(error.message, historyId);
    
    logger.error('数据采集失败', { projectId: project.id, error: error.message });
    throw error;
  }
}

module.exports = {
  collect
};
