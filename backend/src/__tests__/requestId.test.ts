/**
 * requestId.test.ts
 *
 * Tests for the requestIdMiddleware and isValidUuidV4 helper.
 *
 * Issue #648 — Validate X-Request-Id header format to prevent log injection.
 * The middleware now accepts a client-supplied X-Request-Id only when it is a
 * valid UUID v4; any other value is replaced with a freshly generated UUID.
 */

import request from 'supertest';
import express, { Request, Response } from 'express';
import { requestIdMiddleware, getRequestId, isValidUuidV4 } from '../middleware/requestId';
import { createLogger } from '../lib/logger';

const logger = createLogger('test');

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Test app ──────────────────────────────────────────────────────────────────

const createTestApp = () => {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());

  app.get('/test', (req: Request, res: Response) => {
    const requestId = getRequestId();
    logger.info('Test route accessed');
    res.json({
      message: 'success',
      requestId: req.requestId,
      contextRequestId: requestId,
    });
  });

  app.post('/test-async', async (req: Request, res: Response) => {
    const requestId = getRequestId();
    logger.info('Async test route accessed');

    await new Promise((resolve) => setTimeout(resolve, 10));

    const requestIdAfterAsync = getRequestId();

    res.json({
      message: 'success',
      requestIdBefore: requestId,
      requestIdAfter: requestIdAfterAsync,
      match: requestId === requestIdAfterAsync,
    });
  });

  return app;
};

// ── isValidUuidV4 unit tests ──────────────────────────────────────────────────

describe('isValidUuidV4()', () => {
  describe('valid UUIDs', () => {
    it('accepts a canonical UUID v4 (lowercase)', () => {
      expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000')).toBe(false); // v1 format
      expect(isValidUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });

    it('accepts UUID v4 with uppercase hex digits', () => {
      expect(isValidUuidV4('F47AC10B-58CC-4372-A567-0E02B2C3D479')).toBe(true);
    });

    it('accepts UUID v4 with mixed case', () => {
      expect(isValidUuidV4('f47ac10b-58CC-4372-a567-0E02B2C3D479')).toBe(true);
    });

    it('accepts all valid variant bits (8, 9, a, b)', () => {
      // variant nibble must be 8, 9, a, or b
      expect(isValidUuidV4('f47ac10b-58cc-4372-8567-0e02b2c3d479')).toBe(true);
      expect(isValidUuidV4('f47ac10b-58cc-4372-9567-0e02b2c3d479')).toBe(true);
      expect(isValidUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
      expect(isValidUuidV4('f47ac10b-58cc-4372-b567-0e02b2c3d479')).toBe(true);
    });
  });

  describe('invalid values', () => {
    it('rejects an empty string', () => {
      expect(isValidUuidV4('')).toBe(false);
    });

    it('rejects a plain string', () => {
      expect(isValidUuidV4('not-a-uuid')).toBe(false);
    });

    it('rejects a UUID v1 (version digit is 1)', () => {
      expect(isValidUuidV4('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
    });

    it('rejects a UUID v3 (version digit is 3)', () => {
      expect(isValidUuidV4('6ba7b810-9dad-31d1-80b4-00c04fd430c8')).toBe(false);
    });

    it('rejects a UUID v5 (version digit is 5)', () => {
      expect(isValidUuidV4('886313e1-3b8a-5372-9b90-0c9aee199e5d')).toBe(false);
    });

    it('rejects a string with a newline character (log injection)', () => {
      expect(isValidUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479\nINJECTED')).toBe(false);
    });

    it('rejects a string with a carriage return (log injection)', () => {
      expect(isValidUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479\rINJECTED')).toBe(false);
    });

    it('rejects a string with a null byte', () => {
      expect(isValidUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479\x00')).toBe(false);
    });

    it('rejects a UUID without hyphens', () => {
      expect(isValidUuidV4('f47ac10b58cc4372a5670e02b2c3d479')).toBe(false);
    });

    it('rejects a UUID with extra characters appended', () => {
      expect(isValidUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479-extra')).toBe(false);
    });

    it('rejects a very long string', () => {
      expect(isValidUuidV4('a'.repeat(500))).toBe(false);
    });

    it('rejects a string with special shell-injection characters', () => {
      expect(isValidUuidV4('$(rm -rf /)')).toBe(false);
    });
  });
});

// ── requestIdMiddleware integration tests ─────────────────────────────────────

describe('Request ID Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
  });

  // ── Auto-generation ─────────────────────────────────────────────────────────

  describe('Request ID Generation', () => {
    it('generates a UUID v4 when no X-Request-Id header is provided', async () => {
      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
    });

    it('generates different IDs for different requests', async () => {
      const r1 = await request(app).get('/test');
      const r2 = await request(app).get('/test');

      expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
    });
  });

  // ── Valid UUID v4 passthrough ───────────────────────────────────────────────

  describe('Valid UUID v4 passthrough', () => {
    it('accepts and echoes a valid UUID v4 supplied by the client', async () => {
      const validId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

      const response = await request(app).get('/test').set('X-Request-Id', validId);

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBe(validId);
      expect(response.body.requestId).toBe(validId);
    });

    it('accepts a valid UUID v4 with uppercase hex digits', async () => {
      const validId = 'F47AC10B-58CC-4372-A567-0E02B2C3D479';

      const response = await request(app).get('/test').set('X-Request-Id', validId);

      expect(response.headers['x-request-id']).toBe(validId);
    });
  });

  // ── Invalid value rejection ─────────────────────────────────────────────────

  describe('Invalid X-Request-Id rejection', () => {
    it('replaces an empty X-Request-Id with a generated UUID', async () => {
      const response = await request(app).get('/test').set('X-Request-Id', '');

      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
    });

    it('replaces an arbitrary string with a generated UUID', async () => {
      const response = await request(app)
        .get('/test')
        .set('X-Request-Id', 'my-custom-request-id-123');

      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
      expect(response.headers['x-request-id']).not.toBe('my-custom-request-id-123');
    });

    it('replaces a newline-injection attempt with a generated UUID', async () => {
      const injected = 'f47ac10b-58cc-4372-a567-0e02b2c3d479\nX-Injected-Header: evil';

      const response = await request(app).get('/test').set('X-Request-Id', injected);

      // The response ID must be a clean UUID — not the injected string
      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
      expect(response.headers['x-request-id']).not.toContain('\n');
    });

    it('replaces a carriage-return injection attempt with a generated UUID', async () => {
      const injected = 'f47ac10b-58cc-4372-a567-0e02b2c3d479\rINJECTED';

      const response = await request(app).get('/test').set('X-Request-Id', injected);

      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
      expect(response.headers['x-request-id']).not.toContain('\r');
    });

    it('replaces a very long string with a generated UUID', async () => {
      const longId = 'a'.repeat(500);

      const response = await request(app).get('/test').set('X-Request-Id', longId);

      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
    });

    it('replaces a UUID v1 (non-v4) with a generated UUID', async () => {
      const uuidV1 = '550e8400-e29b-11d4-a716-446655440000';

      const response = await request(app).get('/test').set('X-Request-Id', uuidV1);

      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
      expect(response.headers['x-request-id']).not.toBe(uuidV1);
    });

    it('replaces a UUID without hyphens with a generated UUID', async () => {
      const noHyphens = 'f47ac10b58cc4372a5670e02b2c3d479';

      const response = await request(app).get('/test').set('X-Request-Id', noHyphens);

      expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
    });
  });

  // ── Response headers ────────────────────────────────────────────────────────

  describe('Response Headers', () => {
    it('always includes X-Request-Id in response headers', async () => {
      const response = await request(app).get('/test');

      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('returns the same ID in header and response body', async () => {
      const response = await request(app).get('/test');

      expect(response.headers['x-request-id']).toBe(response.body.requestId);
    });
  });

  // ── Request context ─────────────────────────────────────────────────────────

  describe('Request Context', () => {
    it('attaches request ID to the request object', async () => {
      const response = await request(app).get('/test');

      expect(response.body.requestId).toBeDefined();
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    });

    it('makes request ID available via getRequestId()', async () => {
      const response = await request(app).get('/test');

      expect(response.body.contextRequestId).toBe(response.headers['x-request-id']);
    });

    it('maintains request ID across async operations', async () => {
      const response = await request(app).post('/test-async');

      expect(response.status).toBe(200);
      expect(response.body.match).toBe(true);
      expect(response.body.requestIdBefore).toBe(response.headers['x-request-id']);
    });
  });

  // ── Concurrent requests ─────────────────────────────────────────────────────

  describe('Concurrent requests', () => {
    it('handles concurrent requests with valid UUID v4 IDs correctly', async () => {
      // Use valid UUID v4 values so they pass validation and are echoed back
      const validIds = [
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        'a8098c1a-f86e-11da-bd1a-00112444be1e',
        '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
        '6ba7b811-9dad-41d1-80b4-00c04fd430c8',
        '6ba7b812-9dad-41d1-80b4-00c04fd430c8',
      ];

      const responses = await Promise.all(
        validIds.map((id) => request(app).get('/test').set('X-Request-Id', id)),
      );

      responses.forEach((response, i) => {
        expect(response.headers['x-request-id']).toBe(validIds[i]);
      });
    });

    it('generates unique IDs for concurrent requests without a header', async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => request(app).get('/test')),
      );

      const ids = responses.map((r) => r.headers['x-request-id']);
      const unique = new Set(ids);
      expect(unique.size).toBe(10);
    });
  });
});

// ── getRequestId outside request context ─────────────────────────────────────

describe('getRequestId() outside request context', () => {
  it('returns undefined when called outside request context', () => {
    const requestId = getRequestId();
    expect(requestId).toBeUndefined();
  });
});

// ─── #1101 — UUID generation, X-Request-ID header injection, logger context ──

describe('#1101 requestIdMiddleware', () => {
  it('generates a UUID-shaped request ID and sets it on req', async () => {
    const response = await request(createTestApp()).get('/test');
    expect(response.body.requestId).toMatch(UUID_V4_REGEX);
  });

  it('sets X-Request-Id response header with the same ID as req.requestId', async () => {
    const response = await request(createTestApp()).get('/test');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('uses client-supplied X-Request-Id when it is a valid UUID v4', async () => {
    const id = 'a3bb189e-8bf9-4c8b-9bea-a9d6b6e7d9f4';
    const response = await request(createTestApp()).get('/test').set('X-Request-Id', id);
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.body.requestId).toBe(id);
  });

  it('generates a new UUID when client-supplied X-Request-Id is not a valid UUID v4', async () => {
    const response = await request(createTestApp()).get('/test').set('X-Request-Id', 'not-a-uuid');
    expect(response.headers['x-request-id']).toMatch(UUID_V4_REGEX);
    expect(response.headers['x-request-id']).not.toBe('not-a-uuid');
  });

  it('binds request ID to logger context (getRequestId() returns same ID inside handler)', async () => {
    const response = await request(createTestApp()).get('/test');
    // contextRequestId is populated via getRequestId() inside the route handler,
    // proving the ID is bound to AsyncLocalStorage (logger context).
    expect(response.body.contextRequestId).toBe(response.headers['x-request-id']);
  });

  it('always calls next() after setup', async () => {
    // A 200 response from the test route proves next() was called.
    const response = await request(createTestApp()).get('/test');
    expect(response.status).toBe(200);
  });
});
