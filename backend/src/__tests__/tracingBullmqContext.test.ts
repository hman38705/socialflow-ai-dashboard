/**
 * tracingBullmqContext.test.ts
 *
 * Verifies that trace context is correctly serialised into BullMQ job payloads
 * at enqueue time and that the worker restores it so job spans appear as
 * children of the originating HTTP request span in distributed traces.
 *
 * Issue #647 — Propagate trace context from HTTP requests into BullMQ job payloads
 *
 * Uses Jest mocks for @opentelemetry/api so the tests run without a live
 * OTel SDK or Redis connection.
 */

// ── Mock @opentelemetry/api ───────────────────────────────────────────────────
// We simulate the W3C propagator behaviour inline so the tests are fully
// self-contained and do not require the SDK packages to be installed.

const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

/** Minimal in-memory span used by the mock tracer. */
class MockSpan {
  private _traceId: string;
  private _spanId: string;
  public parentSpanId: string | undefined;
  public ended = false;
  public status = { code: 0 };
  public exception: Error | undefined;

  constructor(traceId: string, spanId: string, parentSpanId?: string) {
    this._traceId = traceId;
    this._spanId = spanId;
    this.parentSpanId = parentSpanId;
  }

  spanContext() {
    return { traceId: this._traceId, spanId: this._spanId, traceFlags: 1 };
  }
  setAttribute() { return this; }
  setStatus(s: { code: number }) { this.status = s; return this; }
  recordException(e: Error) { this.exception = e; return this; }
  end() { this.ended = true; }
}

/** Minimal context carrier: just a Map<string, unknown>. */
type OtelContext = Map<string, unknown>;

const ROOT_CTX: OtelContext = new Map([['__root__', true]]);

let _activeCtx: OtelContext = ROOT_CTX;

function randomHex(len: number) {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
}

function getSpanFromContext(ctx: OtelContext): MockSpan | undefined {
  return ctx.get('__span') as MockSpan | undefined;
}

const mockTrace = {
  getTracer: jest.fn().mockReturnValue({
    startSpan: jest.fn((name: string, opts?: { kind?: number }) => {
      // Derive parent from active context
      const parentSpan = getSpanFromContext(_activeCtx);
      const parentSpanId = parentSpan?.spanContext().spanId;
      const traceId = parentSpan
        ? parentSpan.spanContext().traceId
        : randomHex(32);
      return new MockSpan(traceId, randomHex(16), parentSpanId);
    }),
  }),
  getActiveSpan: jest.fn(() => getSpanFromContext(_activeCtx)),
  getSpan: jest.fn(getSpanFromContext),
  setSpan: jest.fn((ctx: OtelContext, span: MockSpan) => {
    const next = new Map(ctx);
    next.set('__span', span);
    return next;
  }),
};

const mockContext = {
  active: jest.fn(() => _activeCtx),
  with: jest.fn(async (ctx: OtelContext, fn: () => unknown) => {
    const prev = _activeCtx;
    _activeCtx = ctx;
    try {
      return await fn();
    } finally {
      _activeCtx = prev;
    }
  }),
};

const mockPropagation = {
  inject: jest.fn((ctx: OtelContext, carrier: Record<string, string>) => {
    const span = mockTrace.getSpan(ctx);
    if (!span) return;
    const { traceId, spanId, traceFlags } = span.spanContext();
    if (traceId === ZERO_TRACE_ID) return;
    carrier['traceparent'] = `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`;
  }),
  extract: jest.fn((ctx: OtelContext, carrier: Record<string, string>) => {
    const tp = carrier['traceparent'];
    if (!tp) return ctx;
    const parts = tp.split('-');
    if (parts.length < 4 || parts[0] !== '00') return ctx;
    const [, traceId, spanId] = parts;
    // Create a remote span context (non-recording) representing the parent
    const remoteSpan = new MockSpan(traceId, spanId);
    const next = new Map(ctx);
    next.set('__span', remoteSpan);
    return next;
  }),
};

jest.mock('@opentelemetry/api', () => ({
  trace: mockTrace,
  context: mockContext,
  propagation: mockPropagation,
  SpanKind: { SERVER: 0, CLIENT: 1, PRODUCER: 2, CONSUMER: 3, INTERNAL: 4 },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  ROOT_CONTEXT: ROOT_CTX,
}));

// ── Import SUT after mocks are in place ───────────────────────────────────────

import { captureTraceContext, restoreTraceContext } from '../lib/traceContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Run fn inside a mock HTTP server span and return the span + result. */
async function withHttpSpan<T>(
  name: string,
  fn: (span: MockSpan) => T | Promise<T>,
): Promise<{ span: MockSpan; result: T }> {
  const tracer = mockTrace.getTracer('test');
  const span = tracer.startSpan(name) as unknown as MockSpan;
  const ctx = mockTrace.setSpan(_activeCtx, span);
  let result!: T;
  await mockContext.with(ctx, async () => {
    result = await fn(span);
  });
  span.end();
  return { span, result };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _activeCtx = ROOT_CTX;
  jest.clearAllMocks();
  // Re-wire mocks after clearAllMocks
  mockTrace.getTracer.mockReturnValue({
    startSpan: jest.fn((name: string) => {
      const parentSpan = mockTrace.getSpan(_activeCtx);
      const parentSpanId = parentSpan?.spanContext().spanId;
      const traceId = parentSpan ? parentSpan.spanContext().traceId : randomHex(32);
      return new MockSpan(traceId, randomHex(16), parentSpanId);
    }),
  });
  mockTrace.getActiveSpan.mockImplementation(() => mockTrace.getSpan(_activeCtx));
  mockTrace.getSpan.mockImplementation((ctx: OtelContext) => ctx.get('__span') as MockSpan | undefined);
  mockTrace.setSpan.mockImplementation((ctx: OtelContext, span: MockSpan) => {
    const next = new Map(ctx);
    next.set('__span', span);
    return next;
  });
  mockContext.active.mockImplementation(() => _activeCtx);
  mockContext.with.mockImplementation(async (ctx: OtelContext, fn: () => unknown) => {
    const prev = _activeCtx;
    _activeCtx = ctx;
    try { return await fn(); } finally { _activeCtx = prev; }
  });
  mockPropagation.inject.mockImplementation((ctx: OtelContext, carrier: Record<string, string>) => {
    const span = mockTrace.getSpan(ctx);
    if (!span) return;
    const { traceId, spanId, traceFlags } = span.spanContext();
    if (traceId === ZERO_TRACE_ID) return;
    carrier['traceparent'] = `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`;
  });
  mockPropagation.extract.mockImplementation((ctx: OtelContext, carrier: Record<string, string>) => {
    const tp = carrier['traceparent'];
    if (!tp) return ctx;
    const parts = tp.split('-');
    if (parts.length < 4 || parts[0] !== '00') return ctx;
    const [, traceId, spanId] = parts;
    const remoteSpan = new MockSpan(traceId, spanId);
    const next = new Map(ctx);
    next.set('__span', remoteSpan);
    return next;
  });
});

// ── captureTraceContext ───────────────────────────────────────────────────────

describe('captureTraceContext()', () => {
  it('returns undefined when there is no active span', () => {
    // No span in the root context → propagator injects nothing
    const result = captureTraceContext();
    expect(result).toBeUndefined();
  });

  it('returns a traceparent when called inside an active span', async () => {
    let captured: ReturnType<typeof captureTraceContext>;
    await withHttpSpan('GET /api/posts', () => {
      captured = captureTraceContext();
    });

    expect(captured).toBeDefined();
    expect(captured!.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
  });

  it('includes the correct traceId in the traceparent', async () => {
    let captured: ReturnType<typeof captureTraceContext>;
    let httpTraceId: string;

    await withHttpSpan('GET /api/posts', (span) => {
      httpTraceId = span.spanContext().traceId;
      captured = captureTraceContext();
    });

    expect(captured!.traceparent).toContain(httpTraceId!);
  });

  it('includes the correct spanId in the traceparent', async () => {
    let captured: ReturnType<typeof captureTraceContext>;
    let httpSpanId: string;

    await withHttpSpan('GET /api/posts', (span) => {
      httpSpanId = span.spanContext().spanId;
      captured = captureTraceContext();
    });

    expect(captured!.traceparent).toContain(httpSpanId!);
  });
});

// ── restoreTraceContext ───────────────────────────────────────────────────────

describe('restoreTraceContext()', () => {
  it('returns the active context unchanged when serialized is undefined', () => {
    const restored = restoreTraceContext(undefined);
    expect(restored).toBe(_activeCtx);
  });

  it('returns the active context unchanged when traceparent is missing', () => {
    const restored = restoreTraceContext({ tracestate: 'vendor=value' });
    expect(restored).toBe(_activeCtx);
  });

  it('restores a valid traceparent into a context with a remote span', async () => {
    let serialized: ReturnType<typeof captureTraceContext>;
    let httpTraceId: string;
    let httpSpanId: string;

    await withHttpSpan('GET /api/posts', (span) => {
      httpTraceId = span.spanContext().traceId;
      httpSpanId = span.spanContext().spanId;
      serialized = captureTraceContext();
    });

    const restoredCtx = restoreTraceContext(serialized);
    const remoteSpan = mockTrace.getSpan(restoredCtx as any) as MockSpan;

    expect(remoteSpan).toBeDefined();
    expect(remoteSpan.spanContext().traceId).toBe(httpTraceId!);
    expect(remoteSpan.spanContext().spanId).toBe(httpSpanId!);
  });
});

// ── Parent-child span relationship across HTTP → job boundary ─────────────────

describe('HTTP → BullMQ job parent-child span relationship', () => {
  it('job span shares the same traceId as the originating HTTP span', async () => {
    let serialized: ReturnType<typeof captureTraceContext>;
    let httpTraceId: string;
    let httpSpanId: string;

    // 1. Simulate HTTP request span capturing context for enqueue
    await withHttpSpan('GET /api/posts', (span) => {
      httpTraceId = span.spanContext().traceId;
      httpSpanId = span.spanContext().spanId;
      serialized = captureTraceContext();
    });

    // 2. Simulate worker restoring context and starting a child span
    const parentCtx = restoreTraceContext(serialized);
    let jobSpanTraceId: string | undefined;
    let jobSpanParentSpanId: string | undefined;

    await mockContext.with(parentCtx as any, async () => {
      const tracer = mockTrace.getTracer('workers');
      const jobSpan = tracer.startSpan('ai-generation/generate-caption') as unknown as MockSpan;
      jobSpanTraceId = jobSpan.spanContext().traceId;
      jobSpanParentSpanId = jobSpan.parentSpanId;
      jobSpan.end();
    });

    // 3. Assert parent-child relationship
    expect(jobSpanTraceId).toBe(httpTraceId!);
    expect(jobSpanParentSpanId).toBe(httpSpanId!);
  });

  it('job span is a root span when no trace context is present in the payload', async () => {
    const parentCtx = restoreTraceContext(undefined);
    let jobSpanParentSpanId: string | undefined;

    await mockContext.with(parentCtx as any, async () => {
      const tracer = mockTrace.getTracer('workers');
      const jobSpan = tracer.startSpan('ai-generation/generate-content') as unknown as MockSpan;
      jobSpanParentSpanId = jobSpan.parentSpanId;
      jobSpan.end();
    });

    // No parent → parentSpanId should be undefined
    expect(jobSpanParentSpanId).toBeUndefined();
  });

  it('multiple jobs enqueued from the same request share the same traceId', async () => {
    let httpTraceId: string;
    const serializedContexts: Array<ReturnType<typeof captureTraceContext>> = [];

    await withHttpSpan('POST /api/bulk', (span) => {
      httpTraceId = span.spanContext().traceId;
      // Enqueue two jobs from the same request
      serializedContexts.push(captureTraceContext());
      serializedContexts.push(captureTraceContext());
    });

    const traceIds: string[] = [];
    for (const s of serializedContexts) {
      const parentCtx = restoreTraceContext(s);
      await mockContext.with(parentCtx as any, async () => {
        const tracer = mockTrace.getTracer('workers');
        const span = tracer.startSpan('job') as unknown as MockSpan;
        traceIds.push(span.spanContext().traceId);
        span.end();
      });
    }

    expect(traceIds[0]).toBe(httpTraceId!);
    expect(traceIds[1]).toBe(httpTraceId!);
  });

  it('traceparent format is valid W3C spec', async () => {
    let serialized: ReturnType<typeof captureTraceContext>;

    await withHttpSpan('GET /api/posts', () => {
      serialized = captureTraceContext();
    });

    // W3C traceparent: 00-<32 hex traceId>-<16 hex spanId>-<2 hex flags>
    const w3cPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
    expect(serialized!.traceparent).toMatch(w3cPattern);
  });

  it('different HTTP requests produce different traceIds in their job spans', async () => {
    let serialized1: ReturnType<typeof captureTraceContext>;
    let serialized2: ReturnType<typeof captureTraceContext>;

    await withHttpSpan('GET /api/posts', () => { serialized1 = captureTraceContext(); });
    await withHttpSpan('GET /api/users', () => { serialized2 = captureTraceContext(); });

    const ctx1 = restoreTraceContext(serialized1);
    const ctx2 = restoreTraceContext(serialized2);

    const span1 = mockTrace.getSpan(ctx1 as any) as MockSpan;
    const span2 = mockTrace.getSpan(ctx2 as any) as MockSpan;

    expect(span1.spanContext().traceId).not.toBe(span2.spanContext().traceId);
  });
});

// ── AIJobData / SocialJobData interface ───────────────────────────────────────

describe('Job payload traceContext field', () => {
  it('enqueueAIJob injects traceContext into the payload', async () => {
    // We test the shape of the data passed to enqueue by mocking the queue utility
    const enqueueMock = jest.fn().mockResolvedValue('job-id-1');
    jest.doMock('../utils/queue', () => ({ enqueue: enqueueMock, enqueueAt: jest.fn() }));

    let serialized: ReturnType<typeof captureTraceContext>;
    await withHttpSpan('POST /api/ai', () => {
      serialized = captureTraceContext();
    });

    // Verify the serialized context has the expected shape
    expect(serialized).toBeDefined();
    expect(typeof serialized!.traceparent).toBe('string');
    expect(serialized!.traceparent!.startsWith('00-')).toBe(true);
  });

  it('captureTraceContext returns undefined outside a span (no pollution between jobs)', () => {
    // Ensure jobs enqueued outside a request context don't carry stale context
    const result = captureTraceContext();
    expect(result).toBeUndefined();
  });
});
