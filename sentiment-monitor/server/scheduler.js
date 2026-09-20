const cron = require('node-cron');
const DecisionEngine = require('./decision-engine');
const notifier = require('./notifier');
const collector = require('./collector');
const { getDb } = require('./db');
const logger = require('./logger');
const { acquireLock, releaseLock, isLocked } = require('./lock');

// 全局默认配置（当项目未配置时使用）
const DEFAULT_PROJECT_SCHEDULE = {
  dailyCron: '0 8 * * *',
  healthCheckCron: '0 * * * *',
};

class Scheduler {
  constructor() {
    this.engine = new DecisionEngine();
    this.jobs = [];
    this.isRunning = false;
    this.lastRunTime = null;
    this.lastRunResult = null;
  }

  /**
   * 获取项目的定时任务配置
   */
  getProjectSchedule(project) {
    try {
      const config = JSON.parse(project.config || '{}');
      return {
        dailyCron: config.schedule?.dailyCron || DEFAULT_PROJECT_SCHEDULE.dailyCron,
        healthCheckCron: config.schedule?.healthCheckCron || DEFAULT_PROJECT_SCHEDULE.healthCheckCron,
      };
    } catch (err) {
      return { ...DEFAULT_PROJECT_SCHEDULE };
    }
  }

  /**
   * 获取全局状态（用于 API 返回）
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      lastRunResult: this.lastRunResult,
    };
  }

  /**
   * 启动定时任务
   * 为每个启用的项目创建独立的定时任务
   */
  start() {
    this.stop();

    const db = getDb();
    const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();

    for (const project of projects) {
      const schedule = this.getProjectSchedule(project);
      
      // 为每个项目创建每日采集任务
      const dailyJob = cron.schedule(schedule.dailyCron, async () => {
        logger.info('开始执行每日采集任务', { projectId: project.id, name: project.name });

        if (isLocked()) {
          logger.warn('已有任务在运行，跳过', { projectId: project.id });
          return;
        }

        try {
          acquireLock();
          this.isRunning = true;

          // 执行数据采集
          const result = await collector.collect(project, 'scheduled');
          
          // 执行决策引擎检查
          const healthDecisions = this.engine.checkSourceHealth(project.id);
          if (healthDecisions.length > 0) {
            this.engine.executeDecisions(project.id, healthDecisions);
            await notifier.sendDecisionNotification(project.id, healthDecisions);
          }

          this.lastRunTime = new Date().toISOString();
          this.lastRunResult = `success (${project.name})`;
          logger.info('每日采集任务完成', { projectId: project.id, itemsCount: result.itemsCount });
        } catch (err) {
          logger.error('每日采集任务失败', { projectId: project.id, error: err.message });
          this.lastRunTime = new Date().toISOString();
          this.lastRunResult = `error: ${err.message} (${project.name})`;
          await notifier.sendErrorNotification(err);
        } finally {
          releaseLock();
          this.isRunning = false;
        }
      }, {
        scheduled: true,
        timezone: "Asia/Shanghai"
      });

      this.jobs.push({ projectId: project.id, type: 'daily', job: dailyJob });

      // 为每个项目创建健康度检查任务
      const healthJob = cron.schedule(schedule.healthCheckCron, async () => {
        const decisions = this.engine.checkSourceHealth(project.id);
        if (decisions.length > 0) {
          this.engine.executeDecisions(project.id, decisions);
          await notifier.sendDecisionNotification(project.id, decisions);
        }
      }, {
        scheduled: true,
        timezone: "Asia/Shanghai"
      });

      this.jobs.push({ projectId: project.id, type: 'health', job: healthJob });
    }

    logger.info('定时任务已启动', { projectsCount: projects.length });
  }

  stop() {
    this.jobs.forEach(({ job }) => job.stop());
    this.jobs = [];
    logger.info('定时任务已停止');
  }

  restart() {
    this.start();
  }

  /**
   * 手动触发采集
   */
  async triggerManualCollection(projectId) {
    if (isLocked()) {
      throw new Error('已有任务在运行，请稍后再试');
    }

    try {
      acquireLock();
      this.isRunning = true;

      const db = getDb();
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      
      if (!project) {
        throw new Error('项目不存在');
      }

      logger.info('手动采集项目', { projectId: project.id, name: project.name });

      // 执行真正的数据采集
      const result = await collector.collect(project, 'manual');
      
      // 执行决策引擎检查
      const healthDecisions = this.engine.checkSourceHealth(project.id);
      if (healthDecisions.length > 0) {
        this.engine.executeDecisions(project.id, healthDecisions);
        await notifier.sendDecisionNotification(project.id, healthDecisions);
      }

      this.lastRunTime = new Date().toISOString();
      this.lastRunResult = `success (manual, ${result.itemsCount} items)`;

      return result;
    } catch (err) {
      this.lastRunTime = new Date().toISOString();
      this.lastRunResult = 'error: ' + err.message;
      throw err;
    } finally {
      releaseLock();
      this.isRunning = false;
    }
  }
}

module.exports = new Scheduler();
