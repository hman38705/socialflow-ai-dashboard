/**
 * tracingMiddleware.test.ts
 *
 * Unit tests for the Express tracingMiddleware covering:
 *  - OTel span creation (SERVER kind, initial attributes)
 *  - W3C trace-context propagation via X-Trace-Id / X-Span-Id response headers
 *  - http.status_code attribute recording and span status on finish
 *  - ERROR status on 5xx, OK status on 2xx/3xx/4xx
 *  - span.end() called exactly once after the response finishes
 *  - next() forwarded inside context.with()
 *
 * @opentelemetry/api is fully mocked — no live SDK or OTLP exporter needed.
 */

// ── Mock @opentelemetry/api ───────────────────────────────────────────────────
// Defined before jest.mock() so the factory closure can reference them.
// (jest.mock is hoisted; the factory runs lazily when the module is first
// required, by which time all module-level variables are initialised.)

const MOCK_TRACE_ID = 'aabbccdd11223344aabbccdd11223344';
const MOCK_SPAN_ID  = 'aabbccdd11223344';

class MockSpan {
  public attributes: Record<string, unknown> = {};
  public status: { code: number; message?: string } = { code: 0 };
  public ended = false;

  spanContext() {
    return { traceId: MOCK_TRACE_ID, spanId: MOCK_SPAN_ID, traceFlags: 1 };
  }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
    return this;
  }
  setStatus(s: { code: number; message?: string }) {
    this.status = s;
    return this;
  }
  end() {
    this.ended = true;
  }
}

let currentSpan: MockSpan;

const mockStartSpan = jest.fn((_name: string, opts?: { kind?: number; attributes?: Record<string, unknown> }) => {
  currentSpan = new MockSpan();
  if (opts?.attributes) {
    Object.assign(currentSpan.attributes, opts.attributes);
  }
  return currentSpan;
});

const mockTrace = {
  getTracer: jest.fn(() => ({ startSpan: mockStartSpan })),
  setSpan: jest.fn((_ctx: unknown, _span: unknown) => 'ctx-with-span'),
};

const mockContextActive = jest.fn(() => 'root-ctx');
const mockContextWith = jest.fn((_ctx: unknown, fn: () => void) => fn());

const mockContext = {
  active: mockContextActive,
  with: mockContextWith,
};

jest.mock('@opentelemetry/api', () => ({
  trace: mockTrace,
  context: mockContext,
  SpanKind: { SERVER: 0, CLIENT: 1, PRODUCER: 2, CONSUMER: 3, INTERNAL: 4 },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { tracingMiddleware } from '../middleware/tracingMiddleware';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<{
  method: string;
  path: string;
  originalUrl: string;
  headers: Record<string, string>;
}> = {}): Request {
  return {
    method: 'GET',
    path: '/api/posts',
    originalUrl: '/api/posts',
    headers: { 'user-agent': 'Jest/1.0' },
    ...overrides,
  } as unknown as Request;
}

type FakeRes = {
  statusCode: number;
  setHeader: jest.Mock;
  on: (event: string, cb: () => void) => void;
  emit: (event: string) => void;
};

function makeRes(statusCode = 200): FakeRes {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    statusCode,
    setHeader: jest.fn(),
    on(event: string, cb: () => void) {
      (listeners[event] ??= []).push(cb);
    },
    emit(event: string) {
      listeners[event]?.forEach(cb => cb());
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  mockStartSpan.mockImplementation((_name: string, opts?: { kind?: number; attributes?: Record<string, unknown> }) => {
    currentSpan = new MockSpan();
    if (opts?.attributes) {
      Object.assign(currentSpan.attributes, opts.attributes);
    }
    return currentSpan;
  });
  mockTrace.getTracer.mockReturnValue({ startSpan: mockStartSpan });
  mockTrace.setSpan.mockReturnValue('ctx-with-span');
  mockContextActive.mockReturnValue('root-ctx');
  mockContextWith.mockImplementation((_ctx: unknown, fn: () => void) => fn());
});

// ── Span creation ─────────────────────────────────────────────────────────────

describe('tracingMiddleware — span creation', () => {
  it('creates one span per request', () => {
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, jest.fn());
    expect(mockStartSpan).toHaveBeenCalledTimes(1);
  });

  it('names the span "<METHOD> <path>"', () => {
    const req = makeReq({ method: 'POST', path: '/api/users' });
    tracingMiddleware(req, makeRes() as unknown as Response, jest.fn());
    expect(mockStartSpan).toHaveBeenCalledWith('POST /api/users', expect.anything());
  });

  it('starts span with SERVER kind (SpanKind.SERVER = 0)', () => {
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, jest.fn());
    expect(mockStartSpan).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: 0 }),
    );
  });

  it('sets http.method attribute from request.method', () => {
    const req = makeReq({ method: 'DELETE' });
    tracingMiddleware(req, makeRes() as unknown as Response, jest.fn());
    expect(currentSpan.attributes['http.method']).toBe('DELETE');
  });

  it('sets http.url attribute to request.originalUrl', () => {
    const req = makeReq({ originalUrl: '/api/posts?page=2' });
    tracingMiddleware(req, makeRes() as unknown as Response, jest.fn());
    expect(currentSpan.attributes['http.url']).toBe('/api/posts?page=2');
  });

  it('sets http.route attribute to request.path', () => {
    const req = makeReq({ path: '/api/posts/:id' });
    tracingMiddleware(req, makeRes() as unknown as Response, jest.fn());
    expect(currentSpan.attributes['http.route']).toBe('/api/posts/:id');
  });

  it('sets http.user_agent from User-Agent header', () => {
    const req = makeReq({ headers: { 'user-agent': 'MyClient/3.0' } });
    tracingMiddleware(req, makeRes() as unknown as Response, jest.fn());
    expect(currentSpan.attributes['http.user_agent']).toBe('MyClient/3.0');
  });

  it('sets http.user_agent to empty string when User-Agent header is absent', () => {
    const req = makeReq({ headers: {} });
    tracingMiddleware(req, makeRes() as unknown as Response, jest.fn());
    expect(currentSpan.attributes['http.user_agent']).toBe('');
  });
});

// ── W3C trace-context propagation ────────────────────────────────────────────

describe('tracingMiddleware — W3C trace-context propagation', () => {
  it('sets X-Trace-Id response header to the span traceId', () => {
    const res = makeRes();
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', MOCK_TRACE_ID);
  });

  it('sets X-Span-Id response header to the span spanId', () => {
    const res = makeRes();
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith('X-Span-Id', MOCK_SPAN_ID);
  });

  it('calls trace.setSpan with the active context and the new span', () => {
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, jest.fn());
    expect(mockTrace.setSpan).toHaveBeenCalledWith('root-ctx', currentSpan);
  });

  it('invokes next() inside context.with() so downstream code sees the span', () => {
    const callOrder: string[] = [];
    mockContextWith.mockImplementation((_ctx: unknown, fn: () => void) => {
      callOrder.push('context.with');
      fn();
    });
    const next = jest.fn(() => callOrder.push('next'));
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, next as NextFunction);

    expect(callOrder).toEqual(['context.with', 'next']);
  });

  it('passes the context returned by trace.setSpan to context.with()', () => {
    mockTrace.setSpan.mockReturnValue('enriched-ctx');
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, jest.fn());
    expect(mockContextWith).toHaveBeenCalledWith('enriched-ctx', expect.any(Function));
  });
});

// ── Status and error recording on finish ─────────────────────────────────────

describe('tracingMiddleware — error recording on finish', () => {
  it('records http.status_code attribute on 200', () => {
    const res = makeRes(200);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.attributes['http.status_code']).toBe(200);
  });

  it('records http.status_code attribute on 500', () => {
    const res = makeRes(500);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.attributes['http.status_code']).toBe(500);
  });

  it('sets span status to OK (code=1) for 2xx responses', () => {
    const res = makeRes(201);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.status).toEqual({ code: 1 });
  });

  it('sets span status to OK for 3xx responses', () => {
    const res = makeRes(302);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.status).toEqual({ code: 1 });
  });

  it('sets span status to OK for 4xx responses', () => {
    const res = makeRes(404);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.status).toEqual({ code: 1 });
  });

  it('sets span status to ERROR (code=2) for 500', () => {
    const res = makeRes(500);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.status).toEqual({ code: 2, message: 'HTTP 500' });
  });

  it('sets span status to ERROR for 503 with correct message', () => {
    const res = makeRes(503);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    res.emit('finish');
    expect(currentSpan.status.code).toBe(2);
    expect(currentSpan.status.message).toBe('HTTP 503');
  });

  it('ends the span after the response finish event fires', () => {
    const res = makeRes(200);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    expect(currentSpan.ended).toBe(false);
    res.emit('finish');
    expect(currentSpan.ended).toBe(true);
  });

  it('does not end the span before the response finishes', () => {
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, jest.fn());
    expect(currentSpan.ended).toBe(false);
  });

  it('ends the span exactly once', () => {
    const res = makeRes(200);
    tracingMiddleware(makeReq(), res as unknown as Response, jest.fn());
    const endSpy = jest.spyOn(currentSpan, 'end');
    res.emit('finish');
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});

// ── next() forwarding ─────────────────────────────────────────────────────────

describe('tracingMiddleware — next() forwarding', () => {
  it('calls next() exactly once', () => {
    const next = jest.fn();
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() with no arguments', () => {
    const next = jest.fn();
    tracingMiddleware(makeReq(), makeRes() as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});
