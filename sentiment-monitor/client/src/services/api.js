import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// 项目管理
export const projectsApi = {
  list: () => api.get('/projects'),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  enable: (id) => api.post(`/projects/${id}/enable`),
  disable: (id) => api.post(`/projects/${id}/disable`),
};

// 健康度
export const healthApi = {
  overview: (projectId) => api.get(`/projects/${projectId}/health`),
  sources: (projectId) => api.get(`/projects/${projectId}/health/sources`),
  trend: (projectId) => api.get(`/projects/${projectId}/health/trend`),
};

// 历史数据
export const historyApi = {
  items: (projectId, params) => api.get(`/projects/${projectId}/items`, { params }),
  stats: (projectId) => api.get(`/projects/${projectId}/items/stats`),
  export: (projectId, data) => api.post(`/projects/${projectId}/items/export`, data),
};

// 今日热点
export const hotspotsApi = {
  list: (projectId, params) => api.get(`/projects/${projectId}/hotspots`, { params }),
  summary: (projectId) => api.get(`/projects/${projectId}/hotspots/summary`),
};

// 决策记录
export const decisionsApi = {
  list: (params) => api.get('/decisions', { params }),
  get: (id) => api.get(`/decisions/${id}`),
  undo: (id) => api.post(`/decisions/${id}/undo`),
};

// 配置
export const configApi = {
  getRules: () => api.get('/config/rules'),
  updateRules: (data) => api.put('/config/rules', data),
  getLlm: () => api.get('/config/llm'),
  updateLlm: (data) => api.put('/config/llm', data),
  testLlm: (data) => api.post('/config/llm/test', data),
  getEmail: () => api.get('/config/email'),
  updateEmail: (data) => api.put('/config/email', data),
};

// 定时任务
export const schedulerApi = {
  getStatus: () => api.get('/scheduler/status'),
  trigger: (projectId) => api.post('/scheduler/trigger', { projectId }),
  restart: () => api.post('/scheduler/restart'),
};

// 采集历史
export const collectionApi = {
  list: (params) => api.get('/collection', { params }),
  get: (id) => api.get(`/collection/${id}`),
};

// Items 操作
export const itemsApi = {
  update: (id, data) => api.put(`/items/${id}`, data),
  approve: (id) => api.post(`/items/${id}/approve`),
  reject: (id) => api.post(`/items/${id}/reject`),
  batch: (ids, action) => api.post('/items/batch', { ids, action }),
  getSummary: (params) => api.get('/items/summary', { params }),
  removeFromSummary: (id) => api.post(`/items/${id}/remove-from-summary`),
};

// 日志
export const logsApi = {
  getFiles: () => api.get('/logs/files'),
  getContent: (filename, params) => api.get(`/logs/${filename}`, { params }),
  clear: (filename) => api.delete(`/logs/${filename}`),
};

// AI 助手
export const aiApi = {
  chat: (messages) => api.post('/ai/chat', { messages, stream: false }),
  chatStream: (messages, { onStatus, onToken, onDone, onError } = {}) => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, stream: true }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          await res.text().catch(() => '');
          throw new Error(`请求失败 (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of rawEvent.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            let parsed;
            try { parsed = JSON.parse(data); } catch (e) { continue; }
            if (event === 'content' && onToken) onToken(parsed.delta);
            else if (event === 'status' && onStatus) onStatus(parsed.text);
            else if (event === 'done' && onDone) onDone(parsed.content);
            else if (event === 'error' && onError) onError(new Error(parsed.message));
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError' && onError) onError(e);
      }
    })();
    return controller;
  },
};

export default api;
