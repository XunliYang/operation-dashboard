jest.mock('../../../server/ai/llmClient');

const request = require('supertest');
const { app } = require('../../../server/index');
const { getDb } = require('../../../server/db');
const { chatCompletion, chatCompletionStream } = require('../../../server/ai/llmClient');

describe('AI Chat API', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM config');
    jest.clearAllMocks();
  });

  afterAll(() => {
    db.close();
  });

  const sseParser = (r, cb) => {
    let b = '';
    r.on('data', (c) => { b += c; });
    r.on('end', () => cb(null, b));
  };

  it('JSON 模式：执行工具调用并返回最终回答', async () => {
    chatCompletion
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_projects', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ content: '当前没有项目。', tool_calls: [] });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '有哪些项目？' }], stream: false })
      .expect(200);

    expect(res.body.content).toBe('当前没有项目。');
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('JSON 模式：同一轮多个工具调用均被执行', async () => {
    chatCompletion
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_projects', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'get_scheduler_status', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ content: '完成。', tool_calls: [] });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '项目和调度器状态' }], stream: false })
      .expect(200);

    expect(res.body.content).toBe('完成。');
    const secondCallMessages = chatCompletion.mock.calls[1][0].messages;
    const toolMessages = secondCallMessages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((m) => m.tool_call_id).sort()).toEqual(['call_1', 'call_2']);
  });

  it('JSON 模式：未配置 LLM 时返回 400', async () => {
    const err = new Error('LLM 未配置');
    err.code = 'LLM_NOT_CONFIGURED';
    chatCompletion.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }], stream: false })
      .expect(400);

    expect(res.body.error.message).toContain('LLM');
  });

  it('messages 为空时返回 400', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [], stream: false })
      .expect(400);

    expect(res.body.error.message).toBeTruthy();
  });

  it('SSE 模式：返回 content 与 done 事件', async () => {
    chatCompletionStream.mockImplementationOnce(async ({ onToken }) => {
      if (onToken) {
        onToken('你好');
        onToken('，世界');
      }
      return { content: '你好，世界', tool_calls: [] };
    });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '你好' }] })
      .buffer(true)
      .parse(sseParser)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: content');
    expect(res.body).toContain('你好');
    expect(res.body).toContain('event: done');
  });

  it('SSE 模式：LLM 未配置时返回 error 事件', async () => {
    const err = new Error('LLM 未配置');
    err.code = 'LLM_NOT_CONFIGURED';
    chatCompletionStream.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .buffer(true)
      .parse(sseParser)
      .expect(200);

    expect(res.body).toContain('event: error');
    expect(res.body).toContain('LLM');
  });

  it('SSE 模式：工具调用轮返回 status 事件', async () => {
    chatCompletionStream
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_projects', arguments: '{}' } },
        ],
      })
      .mockImplementationOnce(async ({ onToken }) => {
        if (onToken) onToken('完成');
        return { content: '完成', tool_calls: [] };
      });

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ messages: [{ role: 'user', content: '有哪些项目？' }] })
      .buffer(true)
      .parse(sseParser)
      .expect(200);

    expect(res.body).toContain('event: status');
    expect(res.body).toContain('list_projects');
    expect(res.body).toContain('event: content');
    expect(res.body).toContain('event: done');
    expect(chatCompletionStream).toHaveBeenCalledTimes(2);
  });
});
