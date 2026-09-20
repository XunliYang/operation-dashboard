/**
 * 内容相关性检查模块
 * 使用 LLM 判断采集内容是否与关键词相关
 */

const { getDb } = require('./db');
const logger = require('./logger');
const { getLLMConfig, chatCompletion } = require('./ai/llmClient');

async function callLLM(prompt, systemPrompt) {
  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      maxTokens: 10,
    });
    return result.content || null;
  } catch (e) {
    if (e.code === 'LLM_NOT_CONFIGURED') {
      return null;
    }
    throw e;
  }
}

/**
 * 判断单条内容是否与关键词相关
 * @param {string} keyword - 关键词
 * @param {string} title - 标题
 * @param {string} snippet - 摘要
 * @returns {Promise<boolean>} 是否相关
 */
async function checkRelevance(keyword, title, snippet) {
  const content = `${title}\n\n${snippet}`.substring(0, 500);
  
  const prompt = `判断以下文章是否与关键词"${keyword}"相关。

文章内容：
${content}

请只回答 "yes" 或 "no"。`;

  const systemPrompt = '你是一个内容相关性判断助手。判断文章是否主要讨论关键词相关的内容，而不仅仅是提到关键词。只回答 "yes" 或 "no"。';
  
  try {
    const result = await callLLM(prompt, systemPrompt);
    logger.info('LLM 相关性判断结果', { keyword, title: title.substring(0, 50), result });
    return result && result.toLowerCase().includes('yes');
  } catch (error) {
    logger.error('LLM 相关性判断失败', { error: error.message, keyword, title: title.substring(0, 50) });
    return false;
  }
}

/**
 * 批量判断内容相关性
 * @param {Array} items - 内容列表 [{title, snippet, ...}]
 * @param {string} keyword - 关键词
 * @returns {Promise<Array>} 相关的内容列表
 */
async function filterByRelevance(items, keyword) {
  if (!items || items.length === 0) {
    return [];
  }
  
  const llmConfig = getLLMConfig();
  
  // 如果 LLM 未启用，使用简单的关键词匹配作为降级方案
  if (!llmConfig || !llmConfig.enabled) {
    logger.warn('LLM 未启用，使用关键词匹配作为降级方案');
    return items.filter(item => {
      const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
      return text.includes(keyword.toLowerCase());
    });
  }
  
  logger.info('开始 LLM 相关性判断', { count: items.length, keyword });
  
  const results = [];
  const batchSize = 5; // 每批处理 5 条
  let llmFailed = false;
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const isRelevant = await checkRelevance(keyword, item.title, item.snippet);
        return { item, isRelevant };
      })
    );
    
    // 检查是否有 LLM 调用失败
    const failedCount = batchResults.filter(r => !r.isRelevant).length;
    if (failedCount === batch.length && !llmFailed) {
      // 如果整批都失败，可能是 LLM API 问题，降级到关键词匹配
      logger.warn('LLM 相关性判断全部失败，降级到关键词匹配');
      llmFailed = true;
      return items.filter(item => {
        const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
        return text.includes(keyword.toLowerCase());
      });
    }
    
    results.push(...batchResults.filter(r => r.isRelevant).map(r => r.item));
    
    logger.info('LLM 相关性判断进度', { 
      processed: Math.min(i + batchSize, items.length), 
      total: items.length,
      relevant: results.length
    });
  }
  
  logger.info('LLM 相关性判断完成', { 
    total: items.length, 
    relevant: results.length,
    keyword 
  });
  
  return results;
}

module.exports = {
  filterByRelevance,
  checkRelevance,
};
