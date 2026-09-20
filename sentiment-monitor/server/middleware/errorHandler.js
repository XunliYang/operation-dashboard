const logger = require('../logger');

function errorHandler(err, req, res, next) {
  logger.error('错误处理', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const status = err.status || 500;
  const message = err.message || '服务器内部错误';
  const code = err.code || 'INTERNAL_ERROR';

  res.status(status).json({
    error: {
      message,
      code,
    },
  });
}

module.exports = errorHandler;
