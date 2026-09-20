const { execSync } = require('child_process');

/**
 * 使用 web_search 工具搜索 Google News 文章
 * @param {string} keyword - 搜索关键词
 * @returns {Array} 文章列表
 */
function searchGoogleNews(keyword) {
  const items = [];
  
  try {
    // 搜索 Google News 相关文章
    const query = `site:news.google.com "${keyword}"`;
    const result = execSync(
      `web_search --query "${query}" --count 10 --timeout 10`,
      { encoding: 'utf8', timeout: 15000 },
    );
    
    // 解析 web_search 输出（通常是 JSON 或文本格式）
    const lines = result.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.url && data.title) {
          // 从 Google News 页面提取原始文章 URL
          // Google News 的链接通常是跳转到原始文章
          items.push({
            url: data.url,
            title: data.title,
            source: data.source || 'Google News',
          });
        }
      } catch (e) {
        // 忽略非 JSON 行
      }
    }
  } catch (error) {
    console.error('web_search 执行失败:', error.message);
  }
  
  return items;
}

module.exports = { searchGoogleNews };
