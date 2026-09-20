const nodemailer = require('nodemailer');
const { getDb } = require('./db');
const logger = require('./logger');

class Notifier {
  constructor() {
    this.transporters = new Map(); // 缓存每个项目的 transporter
  }

  /**
   * 获取项目的邮件 transporter
   */
  async getTransporter(projectId) {
    if (this.transporters.has(projectId)) {
      return this.transporters.get(projectId);
    }

    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    
    if (!project) {
      logger.warn('项目不存在', { projectId });
      return null;
    }

    let projectConfig;
    try {
      projectConfig = JSON.parse(project.config || '{}');
    } catch (err) {
      logger.error('解析项目配置失败', { projectId, error: err.message });
      return null;
    }

    const emailConfig = projectConfig.email;
    
    if (!emailConfig || !emailConfig.enabled) {
      logger.warn('邮件通知未启用', { projectId });
      return null;
    }

    const smtp = emailConfig.smtp || {};
    
    if (!smtp.host || !smtp.auth?.user || !smtp.auth?.pass) {
      logger.warn('邮件配置不完整', { projectId });
      return null;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure || false,
      auth: {
        user: smtp.auth.user,
        pass: smtp.auth.pass,
      },
    });

    this.transporters.set(projectId, transporter);
    return transporter;
  }

  /**
   * 清除 transporter 缓存（当配置更新时调用）
   */
  clearCache(projectId) {
    if (projectId) {
      this.transporters.delete(projectId);
    } else {
      this.transporters.clear();
    }
  }

  /**
   * 发送决策通知邮件
   */
  async sendDecisionNotification(projectId, decisions) {
    const transporter = await this.getTransporter(projectId);
    if (!transporter) {
      return;
    }

    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    
    let projectConfig;
    try {
      projectConfig = JSON.parse(project.config || '{}');
    } catch (err) {
      logger.error('解析项目配置失败', { projectId, error: err.message });
      return;
    }

    const emailConfig = projectConfig.email || {};
    const recipients = emailConfig.to || [];
    
    if (recipients.length === 0) {
      logger.warn('未配置收件人', { projectId });
      return;
    }

    const subject = `[舆情监控] 自动决策通知 - ${project.name}`;
    const html = `
      <h2>自动决策通知</h2>
      <p>项目 <strong>${project.name}</strong> 触发了以下自动决策：</p>
      <ul>
        ${decisions
          .map(
            d => `
          <li>
            <strong>${d.action}</strong>: ${d.target}<br>
            原因: ${d.reason}
          </li>
        `
          )
          .join('')}
      </ul>
      <p>请登录管理界面查看详情或撤销决策。</p>
    `;

    try {
      await transporter.sendMail({
        from: emailConfig.from || `"舆情监控" <noreply@example.com>`,
        to: recipients.join(', '),
        subject,
        html,
      });

      logger.info('发送决策通知邮件成功', { projectId, decisions: decisions.length });
    } catch (err) {
      logger.error('发送决策通知邮件失败', { projectId, error: err.message });
    }
  }

  /**
   * 发送错误通知邮件（发送给所有启用了邮件的项目）
   */
  async sendErrorNotification(error) {
    const db = getDb();
    const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();

    for (const project of projects) {
      let projectConfig;
      try {
        projectConfig = JSON.parse(project.config || '{}');
      } catch (err) {
        continue;
      }

      const emailConfig = projectConfig.email;
      if (!emailConfig || !emailConfig.enabled) {
        continue;
      }

      const transporter = await this.getTransporter(project.id);
      if (!transporter) {
        continue;
      }

      const recipients = emailConfig.to || [];
      if (recipients.length === 0) {
        continue;
      }

      const subject = `[舆情监控] 系统错误通知 - ${project.name}`;
      const html = `
        <h2>系统错误</h2>
        <p>项目 <strong>${project.name}</strong> 发生错误：</p>
        <p>${error.message}</p>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${error.stack}</pre>
      `;

      try {
        await transporter.sendMail({
          from: emailConfig.from || `"舆情监控" <noreply@example.com>`,
          to: recipients.join(', '),
          subject,
          html,
        });

        logger.info('发送错误通知邮件成功', { projectId: project.id });
      } catch (err) {
        logger.error('发送错误通知邮件失败', { projectId: project.id, error: err.message });
      }
    }
  }
}

module.exports = new Notifier();
