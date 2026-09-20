const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const logger = require('./logger');

const RULES_PATH = path.join(__dirname, '../config/decision-rules.json');

class DecisionEngine {
  constructor() {
    this.rules = this.loadRules();
  }

  loadRules() {
    try {
      return JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
    } catch (err) {
      logger.error('加载决策规则失败', err);
      return {
        sourceHealth: { disableAfterDays: 3, threshold: 0.5 },
        contentQuality: { highVolumeThreshold: 200 },
      };
    }
  }

  checkSourceHealth(projectId) {
    const db = getDb();
    const decisions = [];

    const disabledSources = db
      .prepare('SELECT source FROM disabled_sources WHERE project_id = ?')
      .all(projectId)
      .map(r => r.source);

    const sources = db
      .prepare(
        `
      SELECT source, COUNT(*) as anomalyDays
      FROM source_health
      WHERE project_id = ? 
        AND status = 'anomaly'
        AND date >= date('now', '-${this.rules.sourceHealth.disableAfterDays} days')
      GROUP BY source
    `
      )
      .all(projectId);

    for (const { source, anomalyDays } of sources) {
      if (disabledSources.includes(source)) {
        continue;
      }

      if (anomalyDays >= this.rules.sourceHealth.disableAfterDays) {
        decisions.push({
          action: 'disable_source',
          target: source,
          reason: `连续${anomalyDays}天数据异常`,
        });
      }
    }

    return decisions;
  }

  checkContentQuality(projectId, itemCount) {
    const decisions = [];

    if (itemCount === 0) {
      decisions.push({
        action: 'check_config',
        target: 'project',
        reason: '今日数据量为0，建议检查配置',
      });
    }

    if (itemCount > this.rules.contentQuality.highVolumeThreshold) {
      decisions.push({
        action: 'strict_filter',
        target: 'project',
        reason: `数据量异常多（${itemCount}条），建议启用严格过滤`,
      });
    }

    return decisions;
  }

  executeDecisions(projectId, decisions) {
    const db = getDb();

    for (const decision of decisions) {
      db.prepare(
        'INSERT INTO decisions (project_id, action, target, reason) VALUES (?, ?, ?, ?)'
      ).run(projectId, decision.action, decision.target, decision.reason);

      if (decision.action === 'disable_source') {
        db.prepare(
          'INSERT INTO disabled_sources (project_id, source, reason) VALUES (?, ?, ?)'
        ).run(projectId, decision.target, decision.reason);

        logger.warn('自动禁用源', {
          projectId,
          source: decision.target,
          reason: decision.reason,
        });
      }

      logger.info('执行决策', { projectId, decision });
    }

    return decisions;
  }
}

module.exports = DecisionEngine;
