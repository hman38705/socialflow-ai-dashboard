/**
 * Unit tests for src/instrumentation.ts tracing helpers.
 */
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

const { mockSpan, mockStartActiveSpan } = vi.hoisted(() => {
  const span = {
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
  return {
    mockSpan: span,
    mockStartActiveSpan: vi.fn(
      (_name: string, _opts: unknown, fn: (s: typeof span) => unknown) => fn(span),
    ),
  };
});

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();
  return {
    ...actual,
    trace: { getTracer: () => ({ startActiveSpan: mockStartActiveSpan }) },
  };
});

import { withSpan, traceDbQuery, traceAiCall, traceHttpCall } from './instrumentation';

describe('instrumentation', () => {
  beforeEach(() => {
    mockSpan.setStatus.mockClear();
    mockSpan.recordException.mockClear();
    mockSpan.end.mockClear();
    mockStartActiveSpan.mockClear();
  });

  describe('withSpan', () => {
    it('returns the resolved value of the wrapped function', async () => {
      const result = await withSpan('op', { a: 1 }, async () => 'value');
      expect(result).toBe('value');
    });

    it('starts an internal span with the given name and attributes', async () => {
      await withSpan('op', { a: 1 }, async () => undefined);
      expect(mockStartActiveSpan).toHaveBeenCalledWith(
        'op',
        { kind: SpanKind.INTERNAL, attributes: { a: 1 } },
        expect.any(Function),
      );
    });

    it('passes the span to the wrapped function', async () => {
      const fn = vi.fn().mockResolvedValue(1);
      await withSpan('op', {}, fn);
      expect(fn).toHaveBeenCalledWith(mockSpan);
    });

    it('sets OK status and ends the span on success', async () => {
      await withSpan('op', {}, async () => 1);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('rethrows the original error, records it and ends the span', async () => {
      const error = new Error('boom');
      await expect(
        withSpan('op', {}, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'boom',
      });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('wraps non-Error rejections for recording but rethrows the original value', async () => {
      await expect(withSpan('op', {}, () => Promise.reject('plain'))).rejects.toBe('plain');
      expect(mockSpan.recordException).toHaveBeenCalledWith(expect.any(Error));
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'plain',
      });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('traceDbQuery', () => {
    it('wraps the query in a db span and returns its result', async () => {
      const result = await traceDbQuery('users.findById', 'postgresql', async () => 42);
      expect(result).toBe(42);
      expect(mockStartActiveSpan).toHaveBeenCalledWith(
        'db.users.findById',
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            'db.system': 'postgresql',
            'db.operation': 'users.findById',
            'span.kind': 'client',
          },
        },
        expect.any(Function),
      );
    });

    it('propagates errors', async () => {
      await expect(
        traceDbQuery('q', 'redis', () => Promise.reject(new Error('db fail'))),
      ).rejects.toThrow('db fail');
    });
  });

  describe('traceAiCall', () => {
    it('wraps the call in an ai span and returns its result', async () => {
      const result = await traceAiCall('gemini.generate', 'gemini-pro', async () => 'text');
      expect(result).toBe('text');
      expect(mockStartActiveSpan).toHaveBeenCalledWith(
        'ai.gemini.generate',
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            'ai.operation': 'gemini.generate',
            'ai.model': 'gemini-pro',
            'span.kind': 'client',
          },
        },
        expect.any(Function),
      );
    });

    it('propagates errors', async () => {
      await expect(
        traceAiCall('op', 'm', () => Promise.reject(new Error('ai fail'))),
      ).rejects.toThrow('ai fail');
    });
  });

  describe('traceHttpCall', () => {
    it('wraps the request in an http span with upper-cased method', async () => {
      const result = await traceHttpCall('ipfs', 'post', 'https://ipfs.io', async () => 'ok');
      expect(result).toBe('ok');
      expect(mockStartActiveSpan).toHaveBeenCalledWith(
        'http.ipfs',
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            'http.method': 'POST',
            'http.url': 'https://ipfs.io',
            'peer.service': 'ipfs',
            'span.kind': 'client',
          },
        },
        expect.any(Function),
      );
    });

    it('propagates errors', async () => {
      await expect(
        traceHttpCall('s', 'get', 'u', () => Promise.reject(new Error('http fail'))),
      ).rejects.toThrow('http fail');
    });
  });
});
