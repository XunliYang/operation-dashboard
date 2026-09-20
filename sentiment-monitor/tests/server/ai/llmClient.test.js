const EventEmitter = require('events');
const http = require('http');
const { getDb } = require('../../../server/db');
const { getLLMConfig, chatCompletion, chatCompletionStream } = require('../../../server/ai/llmClient');

describe('llmClient', () => {
  let db;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    db.exec("DELETE FROM config WHERE key = 'llm_config'");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    db.close();
  });

  it('getLLMConfig 未配置时返回 null', () => {
    expect(getLLMConfig()).toBeNull();
  });

  it('getLLMConfig 返回解析后的配置', () => {
    db.prepare("INSERT INTO config (key, value) VALUES ('llm_config', ?)")
      .run(JSON.stringify({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-3.5-turbo', enabled: true }));

    const cfg = getLLMConfig();
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.model).toBe('gpt-3.5-turbo');
    expect(cfg.enabled).toBe(true);
  });

  it('chatCompletion 未配置时抛出 LLM_NOT_CONFIGURED', async () => {
    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
  });

  function mockHttpResponse(statusCode, body) {
    jest.spyOn(http, 'request').mockImplementation((options, callback) => {
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        callback(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
      });
      return {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        destroy: jest.fn(),
      };
    });
  }

  it('chatCompletion 成功返回 content 与 tool_calls', async () => {
    mockHttpResponse(200, JSON.stringify({
      choices: [{ message: { content: '  hello  ', tool_calls: [{ id: 'c1' }] } }],
    }));

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
    });

    expect(result.content).toBe('hello');
    expect(result.tool_calls).toEqual([{ id: 'c1' }]);
  });

  it('chatCompletion 非 200 抛出带 statusCode 的错误', async () => {
    mockHttpResponse(401, JSON.stringify({ error: { message: 'bad api key' } }));

    await expect(
      chatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  function mockHttpChunks(statusCode, chunks, failTimes = 0) {
    let calls = 0;
    jest.spyOn(http, 'request').mockImplementation((options, callback) => {
      calls++;
      const req = { write: jest.fn(), end: jest.fn(), on: jest.fn(), destroy: jest.fn() };
      if (calls <= failTimes) {
        process.nextTick(() => {
          const errHandler = req.on.mock.calls.find((c) => c[0] === 'error')?.[1];
          if (errHandler) errHandler(new Error('ECONNRESET'));
        });
        return req;
      }
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        callback(res);
        for (const c of chunks) res.emit('data', Buffer.from(c));
        res.emit('end');
      });
      return req;
    });
    return () => calls;
  }

  it('chatCompletion 网络错误重试后成功', async () => {
    const getCalls = mockHttpChunks(200, [
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    ], 1);

    const result = await chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      retries: 1,
      retryDelay: 0,
    });

    expect(result.content).toBe('ok');
    expect(getCalls()).toBe(2);
  });

  it('chatCompletionStream 解析 SSE 内容与工具调用', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_projects","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    mockHttpChunks(200, chunks);

    const tokens = [];
    const result = await chatCompletionStream({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      retryDelay: 0,
      onToken: (t) => tokens.push(t),
    });

    expect(result.content).toBe('你好世界');
    expect(tokens).toEqual(['你好', '世界']);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].function.name).toBe('list_projects');
    expect(result.tool_calls[0].function.arguments).toBe('{}');
  });

  it('chatCompletionStream 跨 chunk 的多字节字符不损坏', async () => {
    const sse = Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', 'utf8');
    const niOffset = sse.indexOf(Buffer.from('你', 'utf8'));
    const c1 = sse.slice(0, niOffset + 1);
    const c2 = sse.slice(niOffset + 1);
    mockHttpChunks(200, [c1, c2]);

    const tokens = [];
    const result = await chatCompletionStream({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      retryDelay: 0,
      onToken: (t) => tokens.push(t),
    });

    expect(result.content).toBe('你好');
    expect(tokens.join('')).toBe('你好');
  });

  it('chatCompletion HTTP 错误不重试', async () => {
    const getCalls = mockHttpChunks(401, [JSON.stringify({ error: { message: 'bad key' } })], 0);
    await expect(
      chatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
        retries: 3,
        retryDelay: 0,
      })
    ).rejects.toMatchObject({ code: 'HTTP_401', statusCode: 401 });
    expect(getCalls()).toBe(1);
  });

  it('chatCompletionStream 事件被拆到多个 chunk 也能解析', async () => {
    const sse = Buffer.from('data: {"choices":[{"delta":{"content":"abc"}}]}\n\ndata: {"choices":[{"delta":{"content":"def"}}]}\n\n', 'utf8');
    const mid = Math.floor(sse.length / 2);
    mockHttpChunks(200, [sse.slice(0, mid), sse.slice(mid)]);

    const tokens = [];
    const result = await chatCompletionStream({
      messages: [{ role: 'user', content: 'hi' }],
      config: { apiKey: 'x', baseUrl: 'http://localhost', model: 'm', enabled: true },
      retryDelay: 0,
      onToken: (t) => tokens.push(t),
    });

    expect(result.content).toBe('abcdef');
    expect(tokens.join('')).toBe('abcdef');
  });
});
