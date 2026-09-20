/**
 * email-template.js - 舆情 HTML 邮件模板（增强版）
 */
const configLoader = require('./configLoader');

const RISK_COLORS = {
  high: { bg: '#FEE2E2', text: '#991B1B', border: '#F87171', label: '⚠️ 高风险' },
  medium: { bg: '#FEF3C7', text: '#92400E', border: '#FBBF24', label: '🔶 中风险' },
  low: { bg: '#D1FAE5', text: '#065F46', border: '#34D399', label: '✅ 低风险' },
};

const SENTIMENT_LABELS = {
  positive: '👍 正面',
  negative: '👎 负面',
  neutral: '➖ 中性',
};

function escapeHtml(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimestamp(timestamp) {
  if (!timestamp) {return '';}
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {return '';}
    // 转换为 UTC+8
    const utc8Time = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const yyyy = utc8Time.getUTCFullYear();
    const mm = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc8Time.getUTCDate()).padStart(2, '0');
    const hh = String(utc8Time.getUTCHours()).padStart(2, '0');
    const min = String(utc8Time.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC+8`;
  } catch { return ''; }
}

/**
 * 渲染今日洞察区块
 */
function renderInsights(reportData) {
  const { summary, topItems, recommendations } = reportData;
  const total = summary.total || 0;
  const risk = summary.riskLevels || {};
  const sent = summary.sentiments || {};
  const platforms = summary.platforms || {};
  const platformCount = Object.keys(platforms).filter(k => platforms[k] > 0).length;

  // 生成洞察文本
  const insights = [];
  
  if (total === 0) {
    insights.push('📭 今日未采集到新的舆情数据');
  } else {
    insights.push(`📊 今日共采集到 <b>${total}</b> 条相关信息，来自 <b>${platformCount}</b> 个平台`);
    
    if (risk.high > 0) {
      insights.push(`⚠️ 发现 <b>${risk.high}</b> 条高风险内容，建议立即关注`);
    }
    if (risk.medium > 0) {
      insights.push(`🔶 存在 <b>${risk.medium}</b> 条中风险内容，建议持续监控`);
    }
    if (sent.negative > sent.positive) {
      insights.push(`📉 负面情感内容占比偏高 (${sent.negative}/${total})，建议关注舆论走向`);
    } else if (sent.positive > 0) {
      insights.push(`📈 正面情感内容 ${sent.positive} 条，舆情整体向好`);
    }

    // 主要平台
    const topPlatforms = Object.entries(platforms)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topPlatforms.length > 0) {
      const pStr = topPlatforms.map(([p, c]) => `${p}(${c}条)`).join('、');
      insights.push(`🏷️ 主要活跃平台: ${pStr}`);
    }
  }

  const insightHtml = insights.map(i => `<div style="padding:4px 0;font-size:14px;color:#1F2937;line-height:1.6;">${i}</div>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td style="padding:16px;background:linear-gradient(135deg,#F0F9FF 0%,#E0F2FE 100%);border-radius:12px;border-left:4px solid #0284C7;">
          <div style="font-weight:700;font-size:15px;color:#0369A1;margin-bottom:10px;">💡 今日洞察</div>
          ${insightHtml}
        </td>
      </tr>
    </table>`;
}

/**
 * 渲染统计概览
 */
function renderStatsBar(summary) {
  const risk = summary.riskLevels || {};
  const sent = summary.sentiments || {};
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td style="text-align:center;padding:14px;background:#F3F4F6;border-radius:10px;">
          <div style="font-size:28px;font-weight:700;color:#1F2937;">${summary.total || 0}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:2px;">总计</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px;background:${RISK_COLORS.high.bg};border-radius:10px;">
          <div style="font-size:28px;font-weight:700;color:${RISK_COLORS.high.text};">${risk.high || 0}</div>
          <div style="font-size:12px;color:${RISK_COLORS.high.text};margin-top:2px;">高风险</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px;background:${RISK_COLORS.medium.bg};border-radius:10px;">
          <div style="font-size:28px;font-weight:700;color:${RISK_COLORS.medium.text};">${risk.medium || 0}</div>
          <div style="font-size:12px;color:${RISK_COLORS.medium.text};margin-top:2px;">中风险</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:14px;background:${RISK_COLORS.low.bg};border-radius:10px;">
          <div style="font-size:28px;font-weight:700;color:${RISK_COLORS.low.text};">${risk.low || 0}</div>
          <div style="font-size:12px;color:${RISK_COLORS.low.text};margin-top:2px;">低风险</div>
        </td>
      </tr>
      <tr><td colspan="7" height="8"></td></tr>
      <tr>
        <td style="text-align:center;padding:10px;background:#ECFDF5;border-radius:10px;">
          <div style="font-size:20px;font-weight:600;color:#065F46;">${sent.positive || 0}</div>
          <div style="font-size:11px;color:#065F46;margin-top:2px;">👍 正面</div>
        </td>
        <td width="8"></td>
        <td colspan="3" style="text-align:center;padding:10px;background:#F9FAFB;border-radius:10px;">
          <div style="font-size:20px;font-weight:600;color:#6B7280;">${sent.neutral || 0}</div>
          <div style="font-size:11px;color:#6B7280;margin-top:2px;">➖ 中性</div>
        </td>
        <td width="8"></td>
        <td style="text-align:center;padding:10px;background:#FEF2F2;border-radius:10px;">
          <div style="font-size:20px;font-weight:600;color:#991B1B;">${sent.negative || 0}</div>
          <div style="font-size:11px;color:#991B1B;margin-top:2px;">👎 负面</div>
        </td>
      </tr>
    </table>`;
}

/**
 * 渲染单条信息（增强版）
 */
function renderItem(item, index) {
  const timeStr = formatTimestamp(item.timestamp);
  const riskBadge = (() => {
    const config = RISK_COLORS[item.risk_level] || RISK_COLORS.low;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;background:${config.bg};color:${config.text};border:1px solid ${config.border};">${config.label}</span>`;
  })();
  const sentiment = SENTIMENT_LABELS[item.sentiment] || '➖ 中性';
  const summary = item.summary ? escapeHtml(item.summary) : '';
  const snippet = item.snippet ? escapeHtml(item.snippet).substring(0, 300) : '';
  const platform = item.platform || 'other';

  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #E5E7EB;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:24px;vertical-align:top;padding-top:2px;">
              <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:#EEF2FF;color:#4F46E5;font-size:11px;font-weight:700;">${index}</span>
            </td>
            <td>
              <a href="${escapeHtml(item.url)}" style="color:#2563EB;text-decoration:none;font-weight:600;font-size:14px;line-height:1.4;">${escapeHtml(item.title)}</a>
              <div style="margin-top:4px;">
                <span style="font-size:11px;color:#9CA3AF;background:#F3F4F6;padding:2px 6px;border-radius:4px;">${escapeHtml(platform)}</span>
                ${timeStr ? `<span style="font-size:11px;color:#9CA3AF;margin-left:6px;">⏰ ${timeStr}</span>` : ''}
                <span style="font-size:11px;color:#9CA3AF;margin-left:6px;">${sentiment}</span>
              </div>
              ${summary ? `<div style="margin-top:6px;font-size:13px;color:#374151;line-height:1.6;padding:8px;background:#F9FAFB;border-radius:6px;border-left:3px solid #E5E7EB;">📝 ${summary}</div>` : ''}
              ${snippet && snippet !== summary ? `<div style="margin-top:4px;font-size:12px;color:#6B7280;line-height:1.5;">${snippet}</div>` : ''}
            </td>
            <td style="text-align:right;white-space:nowrap;padding-left:12px;vertical-align:top;">
              ${riskBadge}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/**
 * 渲染平台分类区块
 */
function renderPlatformSection(platformLabel, items, platformKey) {
  if (!items || items.length === 0) {return '';}

  const platformIcons = {
    github: '🐙', csdn: '💻', zhihu: '💬', weixin: '📱', bilibili: '🎬',
    weibo: '🔥', juejin: '⛏️', 'google-news': '🌐', 'bing-news': '📰',
    twitter: '🐦', facebook: '👥', linkedin: '💼',
  };
  const icon = platformIcons[platformKey] || '📋';

  const rows = items.map((item, i) => renderItem(item, i + 1)).join('');
  
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="padding:10px 14px;background:linear-gradient(90deg,#EEF2FF 0%,#F5F3FF 100%);border-radius:8px 8px 0 0;border-left:4px solid #6366F1;">
          <span style="font-weight:700;font-size:15px;color:#3730A3;">${icon} ${escapeHtml(platformLabel)}</span>
          <span style="float:right;font-size:13px;color:#6B7280;font-weight:600;">${items.length} 条</span>
        </td>
      </tr>
      <tr>
        <td style="padding:0 14px 8px;background:#FAFAFA;border-radius:0 0 8px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rows}
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * 渲染建议区块
 */
function renderRecommendations(recommendations) {
  if (!recommendations || recommendations.length === 0) {return '';}
  const items = recommendations.map(r => 
    `<li style="padding:6px 0;font-size:13px;color:#374151;line-height:1.6;border-bottom:1px dashed #E5E7EB;">${escapeHtml(r)}</li>`,
  ).join('');
  
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="padding:16px;background:#FFFBEB;border-radius:12px;border:1px solid #FDE68A;">
          <div style="font-weight:700;font-size:15px;color:#92400E;margin-bottom:10px;">💡 建议与行动项</div>
          <ul style="margin:0;padding-left:20px;list-style:none;">
            ${items}
          </ul>
        </td>
      </tr>
    </table>`;
}

/**
 * 渲染历史总结区块
 */
function renderHistorySummary() {
  const { generateHistorySummary } = require('./report');
  const history = generateHistorySummary();
  if (!history) {return '';}

  const platformRows = history.topPlatforms
    .map(([p, count], i) => `<div style="padding:4px 0;font-size:13px;color:#374151;">${i + 1}. ${escapeHtml(p)}: <b>${count}</b> 条</div>`)
    .join('');

  const keywordRows = Object.entries(history.keywords)
    .filter(([kw]) => kw !== 'unknown')
    .map(([kw, count]) => `<div style="padding:4px 0;font-size:13px;color:#374151;">${escapeHtml(kw)}: <b>${count}</b> 条</div>`)
    .join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="padding:10px 14px;background:linear-gradient(90deg,#F0F9FF 0%,#E0F2FE 100%);border-radius:8px 8px 0 0;border-left:4px solid #0284C7;">
          <span style="font-weight:700;font-size:15px;color:#0369A1;">📈 历史总结（全量数据）</span>
        </td>
      </tr>
      <tr>
        <td style="padding:14px;background:#FAFAFA;border-radius:0 0 8px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align:center;padding:10px;background:#ECFDF5;border-radius:8px;">
                <div style="font-size:12px;color:#6B7280;">监控周期</div>
                <div style="font-size:13px;font-weight:600;color:#065F46;">${history.dateRange.start} ~ ${history.dateRange.end}</div>
                <div style="font-size:11px;color:#6B7280;">${history.days} 天</div>
              </td>
              <td width="8"></td>
              <td style="text-align:center;padding:10px;background:#EEF2FF;border-radius:8px;">
                <div style="font-size:12px;color:#6B7280;">累计采集</div>
                <div style="font-size:18px;font-weight:700;color:#4F46E5;">${history.totalItems}</div>
                <div style="font-size:11px;color:#6B7280;">日均 ${history.avgDaily} 条</div>
              </td>
              <td width="8"></td>
              <td style="text-align:center;padding:10px;background:#FEF3C7;border-radius:8px;">
                <div style="font-size:12px;color:#6B7280;">峰值单日</div>
                <div style="font-size:13px;font-weight:600;color:#92400E;">${history.peakDay.date}</div>
                <div style="font-size:11px;color:#6B7280;">${history.peakDay.count} 条</div>
              </td>
            </tr>
            <tr><td colspan="5" height="10"></td></tr>
            <tr>
              <td colspan="2">
                <div style="font-size:13px;color:#6B7280;margin-bottom:6px;">📡 平台 Top 5</div>
                ${platformRows || '<div style="font-size:13px;color:#9CA3AF;">暂无数据</div>'}
              </td>
              <td width="8"></td>
              <td colspan="2">
                <div style="font-size:13px;color:#6B7280;margin-bottom:6px;">🏷️ 关键词分布</div>
                ${keywordRows || '<div style="font-size:13px;color:#9CA3AF;">暂无数据</div>'}
              </td>
            </tr>
            <tr><td colspan="5" height="8"></td></tr>
            <tr>
              <td colspan="5">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="text-align:center;padding:8px;background:#D1FAE5;border-radius:6px;">
                      <span style="font-size:12px;color:#065F46;">🟢 低风险 ${history.riskLevels.low}</span>
                    </td>
                    <td width="6"></td>
                    <td style="text-align:center;padding:8px;background:#FEF3C7;border-radius:6px;">
                      <span style="font-size:12px;color:#92400E;">🟡 中风险 ${history.riskLevels.medium}</span>
                    </td>
                    <td width="6"></td>
                    <td style="text-align:center;padding:8px;background:#FEE2E2;border-radius:6px;">
                      <span style="font-size:12px;color:#991B1B;">🔴 高风险 ${history.riskLevels.high}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * 生成完整 HTML 邮件
 */
function generateEmailHTML(reportData) {
  const date = reportData.date || new Date().toISOString().split('T')[0];
  const summary = reportData.summary || {};
  const cat = reportData.platformCategorized;
  const recommendations = reportData.recommendations || [];
  const keyword = reportData.keyword || configLoader.getKeywords().join(', ');

  // 构建平台分类内容
  let platformSections = '';
  if (cat) {
    const { PLATFORM_CATEGORIES } = require('./report');
    for (const c of PLATFORM_CATEGORIES) {
      const info = cat[c.key];
      if (info && info.count > 0) {
        platformSections += renderPlatformSection(c.label, info.items, c.key);
      }
    }
  }

  const insights = renderInsights(reportData);
  const statsBar = renderStatsBar(summary);
  const recs = renderRecommendations(recommendations);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${configLoader.renderTemplate(configLoader.getProjectConfig().emailSubject, { displayName: configLoader.getProjectConfig().displayName, date })}</title>
</head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -1px rgba(0,0,0,0.06);">
        
        <!-- Header -->
        <tr>
          <td style="padding:28px 28px 20px;background:linear-gradient(135deg,#667EEA 0%,#764BA2 100%);">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <h1 style="margin:0;font-size:22px;color:#FFFFFF;font-weight:700;letter-spacing:0.5px;">${configLoader.renderTemplate(configLoader.getProjectConfig().reportTitle, { displayName: configLoader.getProjectConfig().displayName })}</h1>
                  <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">📅 ${date} &nbsp;|&nbsp; 🔍 监控关键词: ${escapeHtml(keyword)}</p>
                </td>
                <td style="text-align:right;vertical-align:top;">
                  <span style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.2);border-radius:20px;color:#FFFFFF;font-size:13px;font-weight:600;">
                    共 ${summary.total || 0} 条
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Insights -->
        <tr>
          <td style="padding:20px 28px 0;">
            ${insights}
          </td>
        </tr>

        <!-- Stats Overview -->
        <tr>
          <td style="padding:8px 28px 0;">
            ${statsBar}
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 28px;">
            <div style="height:1px;background:linear-gradient(90deg,transparent 0%,#E5E7EB 50%,transparent 100%);"></div>
          </td>
        </tr>

        <!-- Platform Sections -->
        <tr>
          <td style="padding:12px 28px 20px;">
            <div style="font-weight:700;font-size:16px;color:#1F2937;margin-bottom:12px;">📑 详细内容</div>
            ${platformSections || '<p style="text-align:center;color:#9CA3AF;padding:32px 0;font-size:14px;">📭 今日无新增舆情数据</p>'}
          </td>
        </tr>

        <!-- Recommendations -->
        <tr>
          <td style="padding:0 28px 28px;">
            ${recs}
          </td>
        </tr>

        <!-- History Summary -->
        <tr>
          <td style="padding:0 28px 28px;">
            ${renderHistorySummary()}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 28px;background:linear-gradient(180deg,#F9FAFB 0%,#F3F4F6 100%);border-top:1px solid #E5E7EB;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="text-align:center;">
                  <p style="margin:0;font-size:12px;color:#9CA3AF;">${configLoader.getProjectConfig().displayName} Monitor · 自动生成于 ${new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19)} UTC+8</p>
                  <p style="margin:4px 0 0;font-size:11px;color:#D1D5DB;">数据来源: GitHub、Google News、RSS、微博、V2EX、小红书等</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

module.exports = { generateEmailHTML };
