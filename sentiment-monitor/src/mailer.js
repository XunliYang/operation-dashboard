/**
 * mailer.js - 邮件发送模块
 * 使用 nodemailer 发送 HTML 邮件报告，支持 PDF 附件
 */

const nodemailer = require('nodemailer');
const { generateEmailHTML } = require('./email-template');
const fs = require('fs');
const path = require('path');
const configLoader = require('./configLoader');

/**
 * 创建 SMTP transporter
 * @param {Object} smtpConfig - SMTP 配置
 * @returns {nodemailer.Transporter}
 */
function createTransporter(smtpConfig) {
  // 密码优先从环境变量读取，其次从配置文件读取
  const pass = process.env.SMTP_PASS ||
    process.env.SMTP_PASSWORD ||
    smtpConfig.auth?.pass ||
    '';

  if (!pass) {
    throw new Error('SMTP 密码未配置: 请设置环境变量 SMTP_PASS 或在 config.json 中配置');
  }

  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port || 587,
    secure: smtpConfig.secure || false,
    auth: {
      user: smtpConfig.auth?.user || process.env.SMTP_USER,
      pass,
    },
  });
}

/**
 * 发送报告邮件（支持 PDF 附件）
 * @param {string} date - 日期字符串
 * @param {Object} reportData - generateDailyReport 返回的报告数据
 * @param {Object} config - 邮件配置 (config.email)
 * @param {string} pdfPath - PDF 文件路径（可选）
 * @param {boolean} isProduction - 是否正式发送（使用 productionTo）
 * @returns {Promise<Object>} 发送结果
 */
async function sendReport(date, reportData, config, pdfPath = null, isProduction = false) {
  const emailConfig = config.email || config;
  const proj = configLoader.getProjectConfig();
  
  if (!emailConfig.smtp || !emailConfig.smtp.host) {
    throw new Error('邮件配置不完整: 缺少 SMTP host');
  }

  const transporter = createTransporter(emailConfig.smtp);

  // 生成 HTML 内容
  const html = generateEmailHTML(reportData);

  // 邮件主题
  const subject = (emailConfig.subject || proj.emailSubject)
    .replace('{date}', date);

  // 收件人：正式发送使用 productionTo，否则使用 to
  const recipients = isProduction && emailConfig.productionTo ? 
    emailConfig.productionTo : 
    emailConfig.to;

  // 抄送：正式发送时使用 productionCc
  const ccList = isProduction && emailConfig.productionCc ? 
    emailConfig.productionCc : 
    emailConfig.cc;

  let ccValue;
  if (ccList) {
    ccValue = Array.isArray(ccList) ? ccList.join(', ') : ccList;
  } else {
    ccValue = undefined;
  }

  const mailOptions = {
    from: emailConfig.from || proj.emailFrom,
    to: Array.isArray(recipients) ? recipients.join(', ') : recipients,
    cc: ccValue,
    subject,
    html,
    text: `${proj.displayName} 舆情日报 ${date}\n\n请使用支持 HTML 的邮件客户端查看完整报告。`,
  };

  // 添加 PDF 附件
  if (pdfPath && fs.existsSync(pdfPath)) {
    const pdfFilename = pdfPath.split(/[\\/]/).pop();
    mailOptions.attachments = [
      {
        filename: pdfFilename,
        path: pdfPath,
        contentType: 'application/pdf',
      },
    ];
    console.log(`[mailer] 添加 PDF 附件: ${pdfPath}`);
  }

  console.log(`[mailer] 发送邮件至: ${mailOptions.to}${mailOptions.cc ? ` (抄送: ${mailOptions.cc})` : ''}`);
  const info = await transporter.sendMail(mailOptions);
  console.log(`[mailer] 邮件已发送, Message ID: ${info.messageId}`);

  return { success: true, messageId: info.messageId };
}

module.exports = {
  sendReport,
  createTransporter,
};
