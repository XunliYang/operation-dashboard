/**
 * §5.3 只读聚合端点（LEOY-7 · Phase 3）。
 *
 * GET /api/projects/:id/sentiment/stats?from&to&status
 *
 * 数据源为现有 `items` 表，不改 schema。口径：
 *   - 默认仅统计 `status='approved'`（避免未审核噪音污染结论）；传 `status=all` 关闭该过滤。
 *   - `from` / `to` 为 YYYY-MM-DD（含端点）；缺省时默认最近 30 天。
 *   - 空项目 `total=0`，`score=0`，不除零；跨月区间 `Σ daily.total === total`。
 *   - 全中性 `score=0`。`score = (positive - negative) / total`，范围 -1..1。
 *
 * 不复用 `items/stats`（history.js）：那是「当天 + 风险等级」口径，改它会破坏既有前端。
 */

const express = require('express');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router({ mergeParams: true });

const SENTIMENTS = ['positive', 'neutral', 'negative'];
const DEFAULT_WINDOW_DAYS = 30;
const SPIKE_WINDOW_DAYS = 7;
const SPIKE_MULTIPLIER = 2;
const SPIKE_MIN_COUNT = 3;

function normalizeSentiment(value) {
  return SENTIMENTS.includes(value) ? value : 'neutral';
}

function clampScore(value) {
  return Math.max(-1, Math.min(1, value));
}

/** 校验 YYYY-MM-DD，非法回退 null（视为未传）。 */
function parseDate(raw) {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})$/.exec(String(raw));
  return m ? m[1] : null;
}

/** 组装 WHERE 子句与参数（空数组解构进 better-sqlite3 的参数列表）。 */
function buildFilter(projectId, statusQuery, from, to) {
  const clauses = ['project_id = ?'];
  const params = [projectId];

  if (statusQuery !== 'all') {
    clauses.push("status = 'approved'");
  }
  if (from) {
    clauses.push('date(timestamp) >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('date(timestamp) <= ?');
    params.push(to);
  }
  if (!from && !to) {
    clauses.push("date(timestamp) >= date('now', ?)");
    params.push(`-${DEFAULT_WINDOW_DAYS} days`);
  }
  return { where: clauses.join(' AND '), params };
}

function computeSpike(daily) {
  if (daily.length < 2) return false;
  const latest = daily[daily.length - 1].negative;
  if (latest < SPIKE_MIN_COUNT) return false;
  const start = Math.max(0, daily.length - 1 - SPIKE_WINDOW_DAYS);
  const prior = daily.slice(start, daily.length - 1);
  if (prior.length === 0) return false;
  const baseline = prior.reduce((sum, d) => sum + d.negative, 0) / prior.length;
  return baseline > 0 && latest >= baseline * SPIKE_MULTIPLIER;
}

// GET /api/projects/:id/sentiment/stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const projectId = req.params.id;

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: { message: '项目不存在', code: 'NOT_FOUND' } });
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const { where, params } = buildFilter(projectId, req.query.status, from, to);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM items WHERE ${where}`).get(...params).c;

    const sentimentRows = db
      .prepare(`SELECT sentiment, COUNT(*) AS c FROM items WHERE ${where} GROUP BY sentiment`)
      .all(...params);

    const distribution = { positive: 0, neutral: 0, negative: 0 };
    for (const row of sentimentRows) {
      distribution[normalizeSentiment(row.sentiment)] += row.c;
    }

    const pos = distribution.positive;
    const neg = distribution.negative;
    const score = total > 0 ? clampScore((pos - neg) / total) : 0;

    const ratio =
      total > 0
        ? {
            positive: +(pos / total).toFixed(4),
            neutral: +(distribution.neutral / total).toFixed(4),
            negative: +(neg / total).toFixed(4),
          }
        : { positive: 0, neutral: 0, negative: 0 };

    const dailyRows = db
      .prepare(
        `SELECT date(timestamp) AS d, sentiment, COUNT(*) AS c
           FROM items WHERE ${where}
          GROUP BY d, sentiment ORDER BY d ASC`
      )
      .all(...params);

    const dailyMap = new Map();
    for (const row of dailyRows) {
      if (!dailyMap.has(row.d)) {
        dailyMap.set(row.d, { date: row.d, total: 0, positive: 0, neutral: 0, negative: 0 });
      }
      const entry = dailyMap.get(row.d);
      entry[normalizeSentiment(row.sentiment)] += row.c;
      entry.total += row.c;
    }
    const daily = [...dailyMap.values()].map((entry) => ({
      ...entry,
      score: entry.total > 0 ? clampScore((entry.positive - entry.negative) / entry.total) : 0,
    }));

    const platformRows = db
      .prepare(
        `SELECT source, COUNT(*) AS c FROM items WHERE ${where}
          GROUP BY source ORDER BY c DESC, source ASC`
      )
      .all(...params);
    const platforms = platformRows.map((r) => ({ source: r.source, count: r.c }));

    const lastUpdatedRow = db
      .prepare(`SELECT MAX(timestamp) AS t FROM items WHERE ${where}`)
      .get(...params);
    const lastUpdated = lastUpdatedRow.t || null;

    const spikeDetected = computeSpike(daily);

    res.json({
      total,
      distribution,
      ratio,
      score,
      daily,
      platforms,
      spike_detected: spikeDetected,
      last_updated: lastUpdated,
    });
  } catch (error) {
    logger.error('获取情感聚合失败', error);
    res.status(500).json({ error: { message: '获取情感聚合失败' } });
  }
});

module.exports = router;
module.exports.computeSpike = computeSpike;
module.exports.normalizeSentiment = normalizeSentiment;