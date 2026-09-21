require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { getDb, closeDb } = require('./db');
const logger = require('./logger');
const { auth } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const projectsRouter = require('./api/projects');
const healthRouter = require('./api/health');
const historyRouter = require('./api/history');
const decisionsRouter = require('./api/decisions');
const configRouter = require('./api/config');
const hotspotsRouter = require('./api/hotspots');
const schedulerRouter = require('./api/scheduler');
const collectionRouter = require('./api/collection');
const itemsRouter = require('./api/items');
const logsRouter = require('./api/logs');
const sentimentRouter = require('./api/sentiment');
const scheduler = require('./scheduler');
const chatRouter = require('./ai/chat');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 收紧：生产只允许显式配置的来源；未声明时在开发环境保持宽松但拒绝任意外域。
const corsOrigins = (process.env.SENTIMENT_CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
} else if (process.env.NODE_ENV === 'production') {
  app.use(cors({ origin: false }));
} else {
  app.use(cors());
}

// 网关鉴权：/api/*（除 /api/health）在配置凭据后强制 Basic Auth / Bearer Token。
app.use(auth);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/projects', projectsRouter);
app.use('/api/projects/:id/health', healthRouter);
app.use('/api/projects/:id/hotspots', hotspotsRouter);
app.use('/api/projects/:id/sentiment', sentimentRouter);
app.use('/api/projects/:id', historyRouter);
app.use('/api/decisions', decisionsRouter);
app.use('/api/config', configRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/collection', collectionRouter);
app.use('/api/items', itemsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/ai', chatRouter);

app.use(express.static(path.join(__dirname, '../client/dist')));

// SPA catch-all 路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.use(errorHandler);

function startServer() {
  getDb();
  
  app.listen(PORT, () => {
    logger.info(`服务器启动: http://localhost:${PORT}`);
  });

  if (process.env.NODE_ENV !== 'test') {
    scheduler.start();
  }
}

process.on('SIGINT', () => {
  logger.info('收到关闭信号，正在关闭...');
  scheduler.stop();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('收到关闭信号，正在关闭...');
  scheduler.stop();
  closeDb();
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
