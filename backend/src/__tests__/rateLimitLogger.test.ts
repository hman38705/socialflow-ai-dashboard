/**
 * Degraded-mode tests for rateLimit middleware and logger.
 *
 * Validates that:
 *  1. When `rate-limit-redis` is unavailable the limiter silently falls back
 *     to the in-memory store and the app still boots.
 *  2. When `winston-elasticsearch` is unavailable the logger emits a console
 *     warning and continues with the console transport only.
 *  3. The /health endpoint remains reachable in both degraded states.
 */

// Must be set before any module that reads config is imported
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars!!!!!';
process.env.TWITTER_API_KEY = 'test-key';
process.env.TWITTER_API_SECRET = 'test-secret';

import request from 'supertest';

// ---------------------------------------------------------------------------
// Helper — reset module registry between tests so jest.mock calls take effect
// ---------------------------------------------------------------------------
function freshRequire<T>(modulePath: string): T {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(modulePath) as T;
}

// ---------------------------------------------------------------------------
// 1. rate-limit-redis missing → memory store fallback
// ---------------------------------------------------------------------------
describe('rateLimit — missing rate-limit-redis package', () => {
  beforeEach(() => {
    jest.resetModules();
    // Simulate the package not being installed
    jest.mock('rate-limit-redis', () => {
      throw new Error("Cannot find module 'rate-limit-redis'");
    });
  });

  afterEach(() => {
    jest.unmock('rate-limit-redis');
    jest.resetModules();
  });

  it('initRateLimiters() resolves without throwing', async () => {
    const { initRateLimiters } = freshRequire<typeof import('../middleware/rateLimit')>(
      '../middleware/rateLimit',
    );
    await expect(initRateLimiters()).resolves.toBeUndefined();
  });

  it('authLimiter is defined and is a function after init', async () => {
    const mod = freshRequire<typeof import('../middleware/rateLimit')>(
      '../middleware/rateLimit',
    );
    await mod.initRateLimiters();
    expect(typeof mod.authLimiter).toBe('function');
    expect(typeof mod.aiLimiter).toBe('function');
    expect(typeof mod.generalLimiter).toBe('function');
  });

  it('app boots and /health returns 200 when Redis store is unavailable', async () => {
    // Re-require app after mocking so it picks up the degraded limiter
    const { default: app } = freshRequire<typeof import('../app')>('../app');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});

// ---------------------------------------------------------------------------
// 2. ioredis missing → memory store fallback (same code path, different dep)
// ---------------------------------------------------------------------------
describe('rateLimit — missing ioredis package', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('ioredis', () => {
      throw new Error("Cannot find module 'ioredis'");
    });
  });

  afterEach(() => {
    jest.unmock('ioredis');
    jest.resetModules();
  });

  it('initRateLimiters() resolves and limiters are functions', async () => {
    const mod = freshRequire<typeof import('../middleware/rateLimit')>(
      '../middleware/rateLimit',
    );
    await mod.initRateLimiters();
    expect(typeof mod.authLimiter).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 3. winston-elasticsearch missing → console.warn + logger still works
// ---------------------------------------------------------------------------
describe('logger — missing winston-elasticsearch package', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    jest.resetModules();
    // Simulate the package not being installed
    jest.mock('winston-elasticsearch', () => {
      throw new Error("Cannot find module 'winston-elasticsearch'");
    });
    // Activate the ES transport code path
    process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
  });

  afterEach(() => {
    jest.unmock('winston-elasticsearch');
    delete process.env.ELASTICSEARCH_URL;
    jest.resetModules();
    warnSpy.mockClear();
  });

  afterAll(() => warnSpy.mockRestore());

  it('emits a console.warn about the missing transport', () => {
    freshRequire('../lib/logger');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('winston-elasticsearch not available'),
      expect.any(String),
    );
  });

  it('createLogger() still returns a usable logger', () => {
    const { createLogger } = freshRequire<typeof import('../lib/logger')>('../lib/logger');
    const logger = createLogger('test-scope');
    expect(() => logger.info('hello')).not.toThrow();
    expect(() => logger.warn('degraded')).not.toThrow();
    expect(() => logger.error('oops')).not.toThrow();
  });

  it('app boots and /health returns 200 when ES transport is absent', async () => {
    const { default: app } = freshRequire<typeof import('../app')>('../app');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. Both packages missing simultaneously — belt-and-suspenders
// ---------------------------------------------------------------------------
describe('rateLimit + logger — both optional deps missing', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('rate-limit-redis', () => {
      throw new Error('missing');
    });
    jest.mock('winston-elasticsearch', () => {
      throw new Error('missing');
    });
    process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
  });

  afterEach(() => {
    jest.unmock('rate-limit-redis');
    jest.unmock('winston-elasticsearch');
    delete process.env.ELASTICSEARCH_URL;
    jest.resetModules();
  });

  it('app still boots and /health returns 200', async () => {
    const { default: app } = freshRequire<typeof import('../app')>('../app');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// 5. checkRateLimiterStore uses structured logger instead of console
// ---------------------------------------------------------------------------
describe('checkRateLimiterStore – structured logger', () => {
  const mockLoggerWarn = jest.fn();
  const mockLoggerError = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../lib/logger', () => ({
      createLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: mockLoggerWarn,
        error: mockLoggerError,
      })),
    }));
    jest.mock('rate-limit-redis', () => {
      throw new Error("Cannot find module 'rate-limit-redis'");
    });
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
  });

  afterEach(() => {
    jest.unmock('../lib/logger');
    jest.unmock('rate-limit-redis');
    jest.resetModules();
  });

  it('calls logger.warn (not console.warn) in non-production when Redis store is unavailable', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { checkRateLimiterStore } = freshRequire<typeof import('../middleware/rateLimit')>(
      '../middleware/rateLimit',
    );
    await checkRateLimiterStore(() => {});

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('Rate limiter Redis store unavailable'),
      expect.any(Object),
    );
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('calls logger.error (not console.error) and invokes exit in production when Redis store is unavailable', async () => {
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { checkRateLimiterStore } = freshRequire<typeof import('../middleware/rateLimit')>(
      '../middleware/rateLimit',
    );
    const mockExit = jest.fn();
    await checkRateLimiterStore(mockExit);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('Rate limiter Redis store unavailable'),
      expect.any(Object),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    process.env.NODE_ENV = savedEnv;
  });
});
