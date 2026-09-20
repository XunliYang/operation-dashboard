/**
 * HTTP 客户端：统一走 `/rest/v1` 前缀（由 nginx / Vite dev proxy 转发到后端），
 * 解包 `{code,message,data,request_id}`，非 0 业务码抛 ApiError。
 */
import { CODE_OK, type ApiEnvelope } from '@/core/types';

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/rest/v1';

export class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly requestId: string;

  constructor(message: string, opts: { code: number; status: number; requestId?: string }) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId ?? '-';
  }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Math.random().toString(16).slice(2).padEnd(32, '0');
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 外部传入的 request_id，便于与服务端日志串联 */
  requestId?: string;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, requestId, headers, ...rest } = options;
  const rid = requestId ?? newRequestId();

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': rid,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let envelope: Partial<ApiEnvelope<T>>;
  try {
    envelope = raw ? (JSON.parse(raw) as ApiEnvelope<T>) : {};
  } catch {
    throw new ApiError(`响应不是合法 JSON: ${raw.slice(0, 120)}`, {
      code: -1,
      status: response.status,
      requestId: response.headers.get('X-Request-Id') ?? rid,
    });
  }

  const serverRid = response.headers.get('X-Request-Id') ?? envelope.request_id ?? rid;

  if (!response.ok || (envelope.code ?? CODE_OK) !== CODE_OK) {
    throw new ApiError(envelope.message ?? `HTTP ${response.status}`, {
      code: envelope.code ?? -1,
      status: response.status,
      requestId: serverRid,
    });
  }

  return envelope.data as T;
}

export const api = {
  healthz: () => request<{ status: string; service: string }>('/healthz'),
};
