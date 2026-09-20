const https = require('https');
const http = require('http');
const { getDb } = require('../db');
const { StringDecoder } = require('string_decoder');

const LLM_TIMEOUT = 15000;

function getLLMConfig() {
  const db = getDb();
  const config = db.prepare("SELECT value FROM config WHERE key = 'llm_config'").get();

  if (!config) {
    return null;
  }

  try {
    return JSON.parse(config.value);
  } catch (e) {
    return null;
  }
}

function resolveConfig(config) {
  const llmConfig = config || getLLMConfig();
  if (!llmConfig || !llmConfig.enabled || !llmConfig.apiKey) {
    const error = new Error('LLM 未配置或未启用');
    error.code = 'LLM_NOT_CONFIGURED';
    throw error;
  }
  return llmConfig;
}

function buildBody({ llmConfig, messages, tools, temperature, maxTokens, stream }) {
  const body = {
    model: llmConfig.model || 'gpt-3.5-turbo',
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (stream) {
    body.stream = true;
  }
  return body;
}

function buildRequestOptions({ llmConfig, postData, timeout }) {
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const url = new URL(`${baseUrl}/chat/completions`);
  return {
    url,
    options: {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmConfig.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout,
    },
  };
}

function normalizeHttpError(statusCode, body) {
  let detail = body;
  try {
    const json = JSON.parse(body);
    detail = json.error?.message || body;
  } catch (e) {
    // ignore parse error, keep raw body
  }
  const error = new Error(`LLM 调用失败: ${detail}`);
  error.code = `HTTP_${statusCode}`;
  error.statusCode = statusCode;
  return error;
}

function normalizeTransportError(e, kind) {
  const error = new Error(kind === 'timeout' ? 'LLM 请求超时' : `LLM 网络错误: ${e.message}`);
  error.code = kind === 'timeout' ? 'TIMEOUT' : 'NETWORK';
  return error;
}

async function withRetry(fn, retries, retryDelay, canRetry = () => true) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const retryable = (e.code === 'NETWORK' || e.code === 'TIMEOUT') && canRetry();
      if (!retryable || attempt === retries) {
        throw e;
      }
      if (retryDelay > 0) {
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }
  }
  throw lastError;
}

function makeRequest({ llmConfig, postData, timeout }) {
  const { url, options } = buildRequestOptions({ llmConfig, postData, timeout });
  const protocol = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, (res) => {
      const decoder = new StringDecoder('utf8');
      let data = '';
      res.on('data', (chunk) => { data += decoder.write(chunk); });
      res.on('end', () => { data += decoder.end(); resolve({ statusCode: res.statusCode, body: data }); });
      res.on('error', (e) => reject(normalizeTransportError(e, 'network')));
    });
    req.on('error', (e) => reject(normalizeTransportError(e, 'network')));
    req.on('timeout', () => { req.destroy(); reject(normalizeTransportError(new Error('timeout'), 'timeout')); });
    req.write(postData);
    req.end();
  });
}

async function chatCompletion({ messages, tools, temperature = 0, maxTokens = 1024, config, timeout = LLM_TIMEOUT, retries = 0, retryDelay = 1000 }) {
  const llmConfig = resolveConfig(config);
  const postData = JSON.stringify(buildBody({ llmConfig, messages, tools, temperature, maxTokens, stream: false }));

  const response = await withRetry(() => makeRequest({ llmConfig, postData, timeout }), retries, retryDelay);

  if (response.statusCode !== 200) {
    throw normalizeHttpError(response.statusCode, response.body);
  }

  let json;
  try {
    json = JSON.parse(response.body);
  } catch (e) {
    const error = new Error('LLM 响应解析失败');
    error.code = 'PARSE_ERROR';
    error.statusCode = response.statusCode;
    throw error;
  }

  const message = json.choices?.[0]?.message || {};

  return {
    content: (message.content || '').trim(),
    tool_calls: message.tool_calls || [],
  };
}

function makeStreamRequest({ llmConfig, postData, timeout, onToken }) {
  const { url, options } = buildRequestOptions({ llmConfig, postData, timeout });
  const protocol = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let statusCode;
    let rawBody = '';
    let buffer = '';
    let content = '';
    const toolCallsMap = {};

    const req = protocol.request(options, (res) => {
      statusCode = res.statusCode;
      const decoder = new StringDecoder('utf8');

      res.on('data', (chunk) => {
        if (statusCode !== 200) {
          rawBody += decoder.write(chunk);
          return;
        }
        buffer += decoder.write(chunk);
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of rawEvent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let json;
            try {
              json = JSON.parse(data);
            } catch (e) {
              continue;
            }
            const delta = json.choices?.[0]?.delta || {};
            if (delta.content) {
              content += delta.content;
              if (onToken) onToken(delta.content);
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const i = tc.index ?? 0;
                if (!toolCallsMap[i]) {
                  toolCallsMap[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                }
                if (tc.id) toolCallsMap[i].id += tc.id;
                if (tc.function?.name) toolCallsMap[i].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsMap[i].function.arguments += tc.function.arguments;
              }
            }
          }
        }
      });

      res.on('end', () => {
        if (statusCode !== 200) {
          rawBody += decoder.end();
          resolve({ statusCode, body: rawBody });
          return;
        }
        buffer += decoder.end();
        const tool_calls = Object.keys(toolCallsMap)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => toolCallsMap[k]);
        resolve({ statusCode, content, tool_calls });
      });

      res.on('error', (e) => reject(normalizeTransportError(e, 'network')));
    });

    req.on('error', (e) => reject(normalizeTransportError(e, 'network')));
    req.on('timeout', () => { req.destroy(); reject(normalizeTransportError(new Error('timeout'), 'timeout')); });
    req.write(postData);
    req.end();
  });
}

async function chatCompletionStream({ messages, tools, temperature = 0, maxTokens = 1024, config, timeout = LLM_TIMEOUT, retries = 0, retryDelay = 1000, onToken }) {
  const llmConfig = resolveConfig(config);
  const postData = JSON.stringify(buildBody({ llmConfig, messages, tools, temperature, maxTokens, stream: true }));

  let emitted = false;
  const wrappedOnToken = onToken
    ? (t) => {
        emitted = true;
        try {
          onToken(t);
        } catch (e) {
          // 忽略消费者回调异常，避免中断 LLM 流解析
        }
      }
    : undefined;

  const parsed = await withRetry(
    () => makeStreamRequest({ llmConfig, postData, timeout, onToken: wrappedOnToken }),
    retries,
    retryDelay,
    () => !emitted
  );

  if (parsed.statusCode !== 200) {
    throw normalizeHttpError(parsed.statusCode, parsed.body);
  }

  return {
    content: (parsed.content || '').trim(),
    tool_calls: parsed.tool_calls || [],
  };
}

module.exports = { getLLMConfig, chatCompletion, chatCompletionStream };
