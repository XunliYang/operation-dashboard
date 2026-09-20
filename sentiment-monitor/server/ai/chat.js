const express = require('express');
const { chatCompletion, chatCompletionStream } = require('./llmClient');
const { getToolDefinitions, executeTool } = require('./tools');
const { getDb } = require('../db');
const logger = require('../logger');

const router = express.Router();

const MAX_ITERATIONS = 6;
const CHAT_TIMEOUT = 120000;
const CHAT_MAX_TOKENS = 2048;
const CHAT_RETRIES = 1;
const CHAT_RETRY_DELAY = 1000;

function buildSystemPrompt() {
  let projectSnapshot = '（暂无项目）';
  try {
    const db = getDb();
    const projects = db.prepare('SELECT id, name, enabled FROM projects ORDER BY created_at DESC LIMIT 20').all();
    if (projects.length > 0) {
      projectSnapshot = projects
        .map((p) => `- id=${p.id} 名称="${p.name}" ${p.enabled ? '(启用)' : '(禁用)'}`)
        .join('\n');
    }
  } catch (e) {
    projectSnapshot = '（读取项目列表失败）';
  }

  return `你是舆情监控系统的 AI 助手。你可以通过调用工具帮助用户完成配置、站点添加、项目管理、数据查询等操作。

## 当前项目快照
${projectSnapshot}
（上面快照中的项目 id 可直接用于需要 project_id 的工具，无需先调用 list_projects；若快照可能过期或没有目标项目，再调用 list_projects 确认。）

## 配置概念说明
- 站点（site）对象结构：{"platform": "平台名", "query": "site:域名"}，例如知乎：{"platform":"zhihu","query":"site:zhihu.com"}。
- RSS 源（rssSources）是字符串数组，可用 "{keyword}" 作为关键词占位符，例如 "https://news.google.com/rss?q=%22{keyword}%22"。
- 关键词（keywords）是字符串数组；采集参数在 keywordConfig 里（daysBack 回溯天数、todayOnly 是否只采今天）。

## 规则
1. 执行操作前确认好目标（优先使用上面快照里的项目 id），能用一次工具解决就不要多次往返。
2. 破坏性操作（删除项目、禁用项目、修改 LLM/邮件配置）必须先在回复中向用户说明将要执行的操作并明确请求确认，用户明确同意（如回复"确认""好的""同意"）后才调用对应工具。
3. 工具返回结果后，用简洁的中文向用户说明执行结果。
4. 不要编造数据，所有信息以工具返回结果为准。`;
}

function sendSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // 客户端已断开，忽略写入错误
  }
}

function mapError(error) {
  switch (error.code) {
    case 'LLM_NOT_CONFIGURED':
      return { message: '请先到「系统配置」页面填写 LLM 配置', code: error.code, status: 400 };
    case 'TIMEOUT':
      return { message: 'LLM 响应超时，可能是网关较慢，请重试', code: error.code, status: 504 };
    case 'NETWORK':
      return { message: '无法连接 LLM 服务，请检查网络与 Base URL', code: error.code, status: 502 };
    default:
      if (error.code && String(error.code).startsWith('HTTP_')) {
        return { message: 'LLM 上游服务返回错误，请稍后重试', code: error.code, status: 502, detail: error.message };
      }
      return { message: 'AI Chat 请求失败', code: error.code || 'UNKNOWN', status: 500, detail: error.message };
  }
}

async function runToolCalls(conversation, toolCalls, onStatus) {
  conversation.push({ role: 'assistant', content: null, tool_calls: toolCalls });
  if (onStatus) {
    onStatus(`正在调用：${toolCalls.map((t) => t.function.name).join('、')}`);
  }
  const results = await Promise.all(toolCalls.map((tc) => Promise.resolve().then(() => executeTool(tc))));
  for (let j = 0; j < toolCalls.length; j++) {
    conversation.push({
      role: 'tool',
      tool_call_id: toolCalls[j].id,
      content: JSON.stringify(results[j]),
    });
  }
}

router.post('/chat', async (req, res) => {
  const { messages, stream = true } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages 不能为空' } });
  }

  if (!stream) {
    try {
      const conversation = [{ role: 'system', content: buildSystemPrompt() }, ...messages];
      let finalContent = null;

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const result = await chatCompletion({
          messages: conversation,
          tools: getToolDefinitions(),
          temperature: 0,
          maxTokens: CHAT_MAX_TOKENS,
          timeout: CHAT_TIMEOUT,
          retries: CHAT_RETRIES,
          retryDelay: CHAT_RETRY_DELAY,
        });

        if (result.tool_calls && result.tool_calls.length > 0) {
          await runToolCalls(conversation, result.tool_calls);
        } else {
          finalContent = result.content;
          break;
        }
      }

      if (!finalContent) {
        finalContent = '抱歉，我暂时无法完成这个请求，请稍后再试。';
      }
      return res.json({ content: finalContent });
    } catch (error) {
      const mapped = mapError(error);
      logger.error('AI Chat 请求失败', { error: error.message, code: error.code });
      return res.status(mapped.status).json({ error: { message: mapped.message, code: mapped.code, detail: mapped.detail } });
    }
  }

  let clientClosed = false;
  res.on('close', () => { clientClosed = true; });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const conversation = [{ role: 'system', content: buildSystemPrompt() }, ...messages];
    let finalContent = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (clientClosed) {
        return;
      }
      const result = await chatCompletionStream({
        messages: conversation,
        tools: getToolDefinitions(),
        temperature: 0,
        maxTokens: CHAT_MAX_TOKENS,
        timeout: CHAT_TIMEOUT,
        retries: CHAT_RETRIES,
        retryDelay: CHAT_RETRY_DELAY,
        onToken: (delta) => sendSse(res, 'content', { delta }),
      });

      if (result.tool_calls && result.tool_calls.length > 0) {
        await runToolCalls(conversation, result.tool_calls, (text) => sendSse(res, 'status', { text }));
      } else {
        finalContent = result.content;
        break;
      }
    }

    if (!finalContent) {
      finalContent = '抱歉，我暂时无法完成这个请求，请稍后再试。';
    }
    if (clientClosed) {
      return;
    }
    sendSse(res, 'done', { content: finalContent });
    res.end();
  } catch (error) {
    const mapped = mapError(error);
    logger.error('AI Chat 请求失败', { error: error.message, code: error.code });
    sendSse(res, 'error', { message: mapped.message, code: mapped.code, detail: mapped.detail });
    res.end();
  }
});

module.exports = router;
