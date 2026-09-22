/**
 * fetcher.test.js - fetcher.js 来源标记单元测试
 * 覆盖 LEOY-33：GitHub 条目必须携带真实 source（github-repos / github-issues），
 * 避免落库为 unknown。
 */
const https = require('https');
const { Readable } = require('stream');
const { EventEmitter } = require('events');

const fetcher = require('../../src/fetcher');

/**
 * 拦截 https.get，按 URL 返回指定的 JSON 字符串，模拟 GitHub API 响应。
 * @param {Function} resolveBody - (url) => string
 */
function installHttpsMock(resolveBody) {
  return jest.spyOn(https, 'get').mockImplementation((url, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const requestUrl = typeof url === 'string' ? url : url.href;
    const body = resolveBody(requestUrl);

    const res = new Readable({ read() {} });
    res.statusCode = 200;
    res.headers = {};
    if (typeof callback === 'function') {
      callback(res);
    }
    res.push(body, 'utf8');
    res.push(null);

    const req = new EventEmitter();
    req.destroy = () => {};
    return req;
  });
}

describe('fetcher.fetchGitHub 来源标记', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('repositories 条目携带 source=github-repos', async () => {
    installHttpsMock((url) => {
      if (url.includes('api.github.com/search/repositories')) {
        return JSON.stringify({
          items: [{
            full_name: 'gke-labs/gemini-for-kubernetes-development',
            html_url: 'https://github.com/gke-labs/gemini-for-kubernetes-development',
            description: 'Kubernetes development environment',
            updated_at: '2026-09-20T00:00:00Z',
          }],
        });
      }
      return JSON.stringify([]);
    });

    const items = await fetcher.fetchGitHub('Kubernetes', 'repositories');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.source).toBe('github-repos');
    }
  });

  it('issues 条目携带 source=github-issues', async () => {
    installHttpsMock((url) => {
      if (url.includes('api.github.com/search/issues')) {
        return JSON.stringify({
          items: [{
            title: 'Kubernetes pod crash on start',
            html_url: 'https://github.com/example/repo/issues/1',
            body: 'Kubernetes pods keep crashing',
            updated_at: '2026-09-20T00:00:00Z',
          }],
        });
      }
      return JSON.stringify([]);
    });

    const items = await fetcher.fetchGitHub('Kubernetes', 'issues');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.source).toBe('github-issues');
    }
  });
});