const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router({ mergeParams: true });

const MAX_HOTSPOTS = 50;
const DEFAULT_HOTSPOTS = 10;

// 突增判定：当天负面条数相对前 7 天均值放大倍数与最小样本量
const SPIKE_MULTIPLIER = 2;
const SPIKE_MIN_COUNT = 3;

function clampLimit(raw, fallback = DEFAULT_HOTSPOTS) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {return fallback;}
  return Math.min(n, MAX_HOTSPOTS);
}

// 今日热点列表：按风险等级与时间排序的当天采集条目
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const projectId = req.params.id;
    const limit = clampLimit(req.query.limit);

    let sql = `
      SELECT id, source, source_type, title, url, snippet, timestamp,
             risk_level, sentiment, status, is_summary
      FROM items
      WHERE project_id = ? AND date(timestamp) = date('now')
      ORDER BY
        CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
        timestamp DESC,
        id DESC
      LIMIT ?
    `;

    const items = db.prepare(sql).all(projectId, limit);

    res.json({ date: db.prepare("SELECT date('now') AS d").get().d, total: items.length, items });
  } catch (error) {
    logger.error('获取今日热点失败', error);
    res.status(500).json({ error: { message: '获取今日热点失败' } });
  }
});

// 今日热点摘要统计：总量、风险分布、情感分布、来源分布、突增标记
router.get('/summary', (req, res) => {
  try {
    const db = getDb();
    const projectId = req.params.id;

    const totals = db
      .prepare(
        `
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN risk_level = 'high' THEN 1 END) AS high_risk,
        COUNT(CASE WHEN risk_level = 'medium' THEN 1 END) AS medium_risk,
        COUNT(CASE WHEN risk_level = 'low' THEN 1 END) AS low_risk,
        COUNT(CASE WHEN risk_level IS NULL THEN 1 END) AS unrated,
        COUNT(DISTINCT source) AS sources
      FROM items
      WHERE project_id = ? AND date(timestamp) = date('now')
    `,
      )
      .get(projectId);

    const sentimentRows = db
      .prepare(
        `
      SELECT sentiment, COUNT(*) AS count
      FROM items
      WHERE project_id = ? AND date(timestamp) = date('now')
      GROUP BY sentiment
    `,
      )
      .all(projectId);

    const sentiment = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
    for (const row of sentimentRows) {
      const key = ['positive', 'neutral', 'negative'].includes(row.sentiment) ?
        row.sentiment :
        'unknown';
      sentiment[key] += row.count;
    }

    const sources = db
      .prepare(
        `
      SELECT source, COUNT(*) AS count
      FROM items
      WHERE project_id = ? AND date(timestamp) = date('now')
      GROUP BY source
      ORDER BY count DESC, source ASC
    `,
      )
      .all(projectId);

    // 突增检测：今日负面量 vs 前 7 天负面日均
    const today = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM items
      WHERE project_id = ? AND date(timestamp) = date('now') AND sentiment = 'negative'
    `,
      )
      .get(projectId).count;

    const baselineRow = db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM items
      WHERE project_id = ?
        AND date(timestamp) >= date('now', '-7 days')
        AND date(timestamp) < date('now')
        AND sentiment = 'negative'
    `,
      )
      .get(projectId);
    const baselineAvg = baselineRow.count / 7;

    const spikeDetected =
      today >= SPIKE_MIN_COUNT && baselineAvg > 0 && today >= baselineAvg * SPIKE_MULTIPLIER;

    res.json({
      date: db.prepare("SELECT date('now') AS d").get().d,
      total: totals.total,
      risk: {
        high: totals.high_risk,
        medium: totals.medium_risk,
        low: totals.low_risk,
        unrated: totals.unrated,
      },
      sentiment,
      sources,
      sources_count: totals.sources,
      negative_today: today,
      negative_baseline_avg: Number(baselineAvg.toFixed(2)),
      spike_detected: spikeDetected,
    });
  } catch (error) {
    logger.error('获取今日热点摘要失败', error);
    res.status(500).json({ error: { message: '获取今日热点摘要失败' } });
  }
});

module.exports = router;
