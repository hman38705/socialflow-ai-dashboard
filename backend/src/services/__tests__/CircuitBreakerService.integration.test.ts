/**
 * CircuitBreakerService — integration tests using the real opossum library.
 *
 * The 'circuit-breaker' Jest project does NOT map opossum to a mock, so the
 * real library is loaded here.
 *
 * Fast-transition config (FAST) keeps tests well under the 15 s timeout:
 *   volumeThreshold: 1   → circuit can open after the very first failure
 *   errorThresholdPercentage: 1 → open on any failure
 *   resetTimeout: 200    → half-open probe fires after 200 ms
 *
 * Pattern: call getBreaker(service, FAST) before execute() so the breaker is
 * created with the fast config; subsequent execute() calls reuse it.
 */

// Bypass the manual mock in src/__tests__/__mocks__/opossum.ts so the real
// opossum library is used for these integration tests.
jest.unmock('opossum');

import {
  circuitBreakerService,
  CircuitBreakerError,
  CircuitState,
  CircuitStats,
} from '../CircuitBreakerService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAST = {
  volumeThreshold: 1,
  errorThresholdPercentage: 1,
  resetTimeout: 200,
  rollingCountTimeout: 500,
  rollingCountBuckets: 5,
  timeout: 1000,
};

const fail = () => Promise.reject(new Error('boom'));
const succeed = () => Promise.resolve('ok');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type ServiceName = Parameters<typeof circuitBreakerService.getBreaker>[0];

/** Pre-create a fast breaker then drive it open via failures. */
async function driveOpen(service: ServiceName) {
  circuitBreakerService.getBreaker(service, FAST);
  for (let i = 0; i < 3; i++) {
    await circuitBreakerService.execute(service, fail, () => 'fb').catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CircuitBreakerService — real opossum integration', () => {
  beforeEach(() => {
    // shutdown() clears the breaker map so each test starts fresh
    circuitBreakerService.shutdown();
  });

  afterAll(() => {
    circuitBreakerService.shutdown();
  });

  // ── Basic execution ──────────────────────────────────────────────────────

  describe('execute — happy path', () => {
    it('returns the resolved value', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      const result = await circuitBreakerService.execute('ai', succeed);
      expect(result).toBe('ok');
    });

    it('increments fires and successes in stats', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      await circuitBreakerService.execute('ai', succeed);
      const stats = circuitBreakerService.getStats('ai') as CircuitStats;
      expect(stats.fires).toBeGreaterThanOrEqual(1);
      expect(stats.successes).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Failure + fallback ───────────────────────────────────────────────────

  describe('execute — failure handling', () => {
    it('calls inline fallback when fn rejects', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      const result = await circuitBreakerService.execute('ai', fail, () => 'fallback');
      expect(result).toBe('fallback');
    });

    it('calls registered fallback when fn rejects and no inline fallback', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      circuitBreakerService.registerFallback('ai', () => 'registered');
      const result = await circuitBreakerService.execute('ai', fail);
      expect(result).toBe('registered');
    });

    it('throws CircuitBreakerError for services with enabled fallback strategy (ai)', async () => {
      // ai strategy.enabled = true; no inline or registered fallback
      circuitBreakerService.getBreaker('ai', FAST);
      await expect(circuitBreakerService.execute('ai', fail)).rejects.toBeInstanceOf(CircuitBreakerError);
    });

    it('re-throws original error for services with disabled fallback strategy (twitter)', async () => {
      const err = new Error('twitter down');
      circuitBreakerService.getBreaker('twitter', FAST);
      await expect(circuitBreakerService.execute('twitter', () => Promise.reject(err))).rejects.toBe(err);
    });
  });

  // ── State: CLOSED → OPEN ─────────────────────────────────────────────────

  describe('state transition: closed → open', () => {
    it('circuit opens after failures exceed threshold', async () => {
      await driveOpen('twitter');
      expect(circuitBreakerService.isOpen('twitter')).toBe(true);
    });

    it('rejects immediately (without calling fn) when open', async () => {
      await driveOpen('twitter');
      const fn = jest.fn().mockResolvedValue('x');
      await circuitBreakerService.execute('twitter', fn, () => 'fb').catch(() => {});
      expect(fn).not.toHaveBeenCalled();
    });

    it('getStats reports state as "open"', async () => {
      await driveOpen('twitter');
      const stats = circuitBreakerService.getStats('twitter') as CircuitStats;
      expect(stats.state).toBe<CircuitState>('open');
    });
  });

  // ── State: OPEN → HALF-OPEN ──────────────────────────────────────────────

  describe('state transition: open → half-open', () => {
    it('transitions to half-open after resetTimeout', async () => {
      await driveOpen('twitter');
      expect(circuitBreakerService.isOpen('twitter')).toBe(true);

      await wait(250); // > resetTimeout (200 ms)

      const breaker = circuitBreakerService.getBreaker('twitter');
      expect(breaker.halfOpen).toBe(true);
    });
  });

  // ── State: HALF-OPEN → CLOSED ────────────────────────────────────────────

  describe('state transition: half-open → closed', () => {
    it('closes after a successful probe in half-open state', async () => {
      await driveOpen('twitter');
      await wait(250); // enter half-open

      await circuitBreakerService.execute('twitter', succeed);

      const breaker = circuitBreakerService.getBreaker('twitter');
      expect(breaker.opened).toBe(false);
      expect(breaker.halfOpen).toBe(false);
    });

    it('getStats reports state as "closed" after recovery', async () => {
      await driveOpen('twitter');
      await wait(250);
      await circuitBreakerService.execute('twitter', succeed);

      const stats = circuitBreakerService.getStats('twitter') as CircuitStats;
      expect(stats.state).toBe<CircuitState>('closed');
    });
  });

  // ── State: HALF-OPEN → OPEN (probe fails) ────────────────────────────────

  describe('state transition: half-open → open (probe fails)', () => {
    it('re-opens when the half-open probe fails', async () => {
      await driveOpen('twitter');
      await wait(250); // enter half-open

      await circuitBreakerService.execute('twitter', fail, () => 'fb').catch(() => {});

      expect(circuitBreakerService.isOpen('twitter')).toBe(true);
    });
  });

  // ── Manual open / close ──────────────────────────────────────────────────

  describe('manual open / close', () => {
    it('open() forces circuit open', () => {
      circuitBreakerService.getBreaker('ai', FAST);
      circuitBreakerService.open('ai');
      expect(circuitBreakerService.isOpen('ai')).toBe(true);
    });

    it('close() resets an open circuit', () => {
      circuitBreakerService.getBreaker('ai', FAST);
      circuitBreakerService.open('ai');
      circuitBreakerService.close('ai');
      expect(circuitBreakerService.isOpen('ai')).toBe(false);
    });

    it('open() on unknown service is a no-op', () => {
      expect(() => circuitBreakerService.open('ai')).not.toThrow();
    });

    it('close() on unknown service is a no-op', () => {
      expect(() => circuitBreakerService.close('ai')).not.toThrow();
    });

    it('isOpen() returns false for unknown service', () => {
      expect(circuitBreakerService.isOpen('ai')).toBe(false);
    });
  });

  // ── Statistics ───────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns stats for a specific service', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      await circuitBreakerService.execute('ai', succeed);
      const stats = circuitBreakerService.getStats('ai') as CircuitStats;
      expect(stats).toMatchObject<Partial<CircuitStats>>({
        name: 'ai',
        state: 'closed',
        successes: expect.any(Number),
        failures: expect.any(Number),
        fires: expect.any(Number),
        rejects: expect.any(Number),
        fallbacks: expect.any(Number),
      });
      expect(stats.latency).toHaveProperty('mean');
      expect(stats.latency).toHaveProperty('median');
      expect(stats.latency).toHaveProperty('p95');
      expect(stats.latency).toHaveProperty('p99');
    });

    it('returns an array when no service name given', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      circuitBreakerService.getBreaker('twitter', FAST);
      await circuitBreakerService.execute('ai', succeed);
      await circuitBreakerService.execute('twitter', succeed);
      const all = circuitBreakerService.getStats() as CircuitStats[];
      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBe(2);
    });

    it('throws when service has no breaker', () => {
      expect(() => circuitBreakerService.getStats('ai')).toThrow('Circuit breaker not found: ai');
    });

    it('reports failures count after errors', async () => {
      circuitBreakerService.getBreaker('ai', FAST);
      await circuitBreakerService.execute('ai', fail, () => 'fb').catch(() => {});
      const stats = circuitBreakerService.getStats('ai') as CircuitStats;
      expect(stats.failures).toBeGreaterThanOrEqual(1);
    });

    it('reports rejects when circuit is open', async () => {
      await driveOpen('twitter');
      await circuitBreakerService.execute('twitter', succeed, () => 'fb').catch(() => {});
      const stats = circuitBreakerService.getStats('twitter') as CircuitStats;
      expect(stats.rejects).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Service-specific configs ─────────────────────────────────────────────

  describe('service-specific configurations', () => {
    it.each([
      ['ai', 30000],
      ['twitter', 10000],
      ['translation', 15000],
      ['blockchain', 8000],
      ['ipfs', 20000],
      ['youtube', 15000],
    ] as const)('%s breaker has correct timeout', (service, expected) => {
      const breaker = circuitBreakerService.getBreaker(service);
      // `.options` is set internally by opossum at runtime but not part of its public type defs.
      expect((breaker as unknown as { options: { timeout: number } }).options.timeout).toBe(expected);
    });

    it('returns the same breaker instance on repeated calls', () => {
      const b1 = circuitBreakerService.getBreaker('ai', FAST);
      const b2 = circuitBreakerService.getBreaker('ai', FAST);
      expect(b1).toBe(b2);
    });
  });

  // ── resetAll ─────────────────────────────────────────────────────────────

  describe('resetAll', () => {
    it('closes all open breakers', () => {
      circuitBreakerService.getBreaker('ai', FAST);
      circuitBreakerService.getBreaker('twitter', FAST);
      circuitBreakerService.open('ai');
      circuitBreakerService.open('twitter');
      circuitBreakerService.resetAll();
      expect(circuitBreakerService.isOpen('ai')).toBe(false);
      expect(circuitBreakerService.isOpen('twitter')).toBe(false);
    });
  });

  // ── Timeout event ────────────────────────────────────────────────────────

  describe('timeout event', () => {
    it('fires the timeout event when fn exceeds timeout', async () => {
      // Use a 50 ms timeout so the test completes quickly
      const timeoutConfig = { ...FAST, timeout: 50 };
      circuitBreakerService.getBreaker('ai', timeoutConfig);
      const slow = () => new Promise<string>((r) => setTimeout(() => r('late'), 200));
      // The breaker will time out and throw; catch it
      await circuitBreakerService.execute('ai', slow, () => 'fb').catch(() => {});
      const stats = circuitBreakerService.getStats('ai') as CircuitStats;
      expect(stats.failures).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Fallback event ───────────────────────────────────────────────────────

  describe('fallback event', () => {
    it('fires the fallback event when a registered fallback is invoked', async () => {
      const breaker = circuitBreakerService.getBreaker('ai', FAST);
      // Register a fallback directly on the breaker so opossum fires the 'fallback' event
      breaker.fallback(() => 'breaker-fallback');
      await circuitBreakerService.execute('ai', fail).catch(() => {});
      const stats = circuitBreakerService.getStats('ai') as CircuitStats;
      expect(stats.fallbacks).toBeGreaterThanOrEqual(1);
    });
  });

  // ── CircuitBreakerError ──────────────────────────────────────────────────

  describe('CircuitBreakerError', () => {
    it('has correct name, serviceName, and message', () => {
      const cause = new Error('root');
      const err = new CircuitBreakerError('ai', 'AI unavailable', cause);
      expect(err.name).toBe('CircuitBreakerError');
      expect(err.serviceName).toBe('ai');
      expect(err.message).toBe('AI unavailable');
      expect(err.originalError).toBe(cause);
    });

    it('is an instance of Error', () => {
      expect(new CircuitBreakerError('ai', 'msg')).toBeInstanceOf(Error);
    });

    it('works without originalError', () => {
      const err = new CircuitBreakerError('ai', 'msg');
      expect(err.originalError).toBeUndefined();
    });
  });
});
