/**
 * 网关鉴权中间件（LEOY-7 · P0-1）。
 *
 * 舆情服务只 `expose`、不 `ports`（见 deploy/docker-compose.yml），并在此处统一鉴权：
 * 生产/有凭据环境下对 `/api/*`（除 `/api/health`）强制 Basic Auth 或 Bearer Token，
 * 二者均由环境变量注入（SENTIMENT_AUTH_USER / SENTIMENT_AUTH_PASS，或 SENTIMENT_AUTH_TOKEN）。
 * 未配置任何凭据时视为本地开发 / 测试环境，放行（保持既有 supertest 用例不受影响）。
 */

const HEALTH_PATH = '/api/health';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isApiPath(pathname) {
  return pathname.startsWith('/api/') || pathname === '/api';
}

function auth(req, res, next) {
  // 健康探针始终放行：既供编排层健康检查，也供 BFF 区分「服务在线但未授权」。
  if (!isApiPath(req.path) || req.path === HEALTH_PATH) {
    return next();
  }

  const token = process.env.SENTIMENT_AUTH_TOKEN;
  const user = process.env.SENTIMENT_AUTH_USER;
  const pass = process.env.SENTIMENT_AUTH_PASS;

  // 未配置任何凭据：本地开发 / 测试，放行。
  if (!token && (!user || !pass)) {
    return next();
  }

  const header = req.headers.authorization || '';

  if (token) {
    // 支持 `Authorization: Bearer <token>` 或 `X-Sentiment-Token: <token>`
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const xToken = req.headers['x-sentiment-token'];
    if (timingSafeEqual(bearer, token) || timingSafeEqual(xToken, token)) {
      return next();
    }
    return reject(res);
  }

  // Basic Auth
  if (header.startsWith('Basic ')) {
    let decoded = '';
    try {
      decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8');
    } catch (_) {
      return reject(res);
    }
    const idx = decoded.indexOf(':');
    const u = idx >= 0 ? decoded.slice(0, idx) : '';
    const p = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (timingSafeEqual(u, user) && timingSafeEqual(p, pass)) {
      return next();
    }
  }

  return reject(res);
}

function reject(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="sentiment-monitor"');
  return res.status(401).json({ error: { message: '未认证', code: 'UNAUTHORIZED' } });
}

module.exports = { auth, isApiPath };