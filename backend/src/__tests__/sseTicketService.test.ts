import { SseTicketService } from '../services/sseTicketService';

jest.mock('../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../lib/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe('SseTicketService', () => {
  const TTL_MS = 1000;
  const SWEEP_INTERVAL_MS = 500;
  const CAP = 5;

  let service: SseTicketService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    service = new SseTicketService({
      ttlMs: TTL_MS,
      sweepIntervalMs: SWEEP_INTERVAL_MS,
      maxTickets: CAP,
    });
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('issuance', () => {
    it('returns a hex ticket string', () => {
      const ticket = service.issue('user-1');
      expect(typeof ticket).toBe('string');
      expect(ticket).toMatch(/^[0-9a-f]+$/);
    });

    it('stores an entry with the given userId and expiresAt = now + ttl', () => {
      const now = Date.now();
      const ticket = service.issue('user-1');
      const entry = service.consume(ticket);
      expect(entry).toBeDefined();
      expect(entry?.userId).toBe('user-1');
      expect(entry?.expiresAt).toBe(now + TTL_MS);
    });

    it('issues distinct tickets for successive calls', () => {
      const a = service.issue('user-1');
      const b = service.issue('user-1');
      expect(a).not.toBe(b);
    });
  });

  describe('validation', () => {
    it('consume() returns the entry for a valid ticket', () => {
      const ticket = service.issue('user-1');
      const entry = service.consume(ticket);
      expect(entry).toBeDefined();
      expect(entry?.userId).toBe('user-1');
    });

    it('consume() returns undefined for an unknown ticket', () => {
      const entry = service.consume('deadbeef');
      expect(entry).toBeUndefined();
    });
  });

  describe('expiry', () => {
    it('consume() returns undefined after the TTL has elapsed', () => {
      const ticket = service.issue('user-1');
      jest.advanceTimersByTime(TTL_MS + 1);
      const entry = service.consume(ticket);
      expect(entry).toBeUndefined();
    });

    it('consume() still returns the entry just before the TTL elapses', () => {
      const ticket = service.issue('user-1');
      jest.advanceTimersByTime(TTL_MS - 1);
      const entry = service.consume(ticket);
      expect(entry).toBeDefined();
      expect(entry?.userId).toBe('user-1');
    });
  });

  describe('sweep', () => {
    it('removes expired tickets so they are no longer consumable', () => {
      const ticket = service.issue('user-1');
      jest.advanceTimersByTime(TTL_MS + 1);
      service.sweep();
      const entry = service.consume(ticket);
      expect(entry).toBeUndefined();
    });

    it('removes expired tickets when the sweep interval fires', () => {
      const ticket = service.issue('user-1');
      jest.advanceTimersByTime(TTL_MS + SWEEP_INTERVAL_MS);
      const entry = service.consume(ticket);
      expect(entry).toBeUndefined();
    });

    it('keeps unexpired tickets after a sweep', () => {
      const ticket = service.issue('user-1');
      service.sweep();
      const entry = service.consume(ticket);
      expect(entry).toBeDefined();
      expect(entry?.userId).toBe('user-1');
    });
  });

  describe('single-use', () => {
    it('a consumed ticket cannot be reused', () => {
      const ticket = service.issue('user-1');
      const first = service.consume(ticket);
      expect(first).toBeDefined();
      const second = service.consume(ticket);
      expect(second).toBeUndefined();
    });
  });

  describe('cap behaviour', () => {
    it('keeps the map size bounded when issuing beyond the cap', () => {
      const tickets: string[] = [];
      for (let i = 0; i < CAP + 3; i++) {
        tickets.push(service.issue(`user-${i}`));
      }
      // All but the most recent CAP tickets should have been evicted.
      const consumable = tickets.filter((t) => service.consume(t) !== undefined);
      expect(consumable.length).toBeLessThanOrEqual(CAP);
    });

    it('evicts the oldest ticket when the cap is exceeded', () => {
      const oldest = service.issue('user-oldest');
      for (let i = 0; i < CAP; i++) {
        service.issue(`user-${i}`);
      }
      const entry = service.consume(oldest);
      expect(entry).toBeUndefined();
    });

    it('retains the most recently issued ticket when the cap is exceeded', () => {
      for (let i = 0; i < CAP; i++) {
        service.issue(`user-${i}`);
      }
      const newest = service.issue('user-newest');
      const entry = service.consume(newest);
      expect(entry).toBeDefined();
      expect(entry?.userId).toBe('user-newest');
    });
  });
});