import { describe, expect, it } from 'vitest';

import { ApiError } from '@/core/api';
import { request } from '@/core/api/client';
import { CODE_OK } from '@/core/types';

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
}

describe('api client', () => {
  it('解包 envelope 并返回 data', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch(
      200,
      { code: CODE_OK, message: 'ok', data: { status: 'ok' }, request_id: 'rid-1' },
      { 'X-Request-Id': 'rid-1' },
    );

    try {
      const data = await request<{ status: string }>('/healthz');
      expect(data).toEqual({ status: 'ok' });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('非 0 业务码抛 ApiError 并带 code/requestId', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch(
      404,
      { code: 40400, message: 'Not Found', data: null, request_id: 'rid-2' },
      { 'X-Request-Id': 'rid-2' },
    );

    try {
      await expect(request('/nope')).rejects.toBeInstanceOf(ApiError);
      await expect(request('/nope')).rejects.toMatchObject({ code: 40400, status: 404, requestId: 'rid-2' });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('非 JSON 响应抛 ApiError', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<html>502</html>', { status: 502 })) as typeof fetch;

    try {
      await expect(request('/healthz')).rejects.toBeInstanceOf(ApiError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('请求带上 X-Request-Id 头', async () => {
    const original = globalThis.fetch;
    let seen: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: null, request_id: 'x' }), {
        status: 200,
      });
    }) as typeof fetch;

    try {
      await request('/healthz', { requestId: 'abc123' });
      expect(seen['X-Request-Id']).toBe('abc123');
    } finally {
      globalThis.fetch = original;
    }
  });
});
