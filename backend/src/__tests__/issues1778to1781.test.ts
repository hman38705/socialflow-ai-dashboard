import { readBodyCapped } from '../services/WebhookDispatcher';
import { uploadUrlSchema } from '../routes/tiktok';
import { validateEnv } from '../config/config';

jest.mock('../lib/prisma', () => ({ prisma: {} }));
jest.mock('../lib/metrics', () => ({ webhookDispatchFailed: {}, webhookDispatchTotal: {} }));
jest.mock('../lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../middleware/authenticate', () => ({ authenticate: jest.fn() }));
jest.mock('../middleware/checkPermission', () => ({ checkPermission: () => jest.fn() }));
jest.mock('../services/TikTokService', () => ({ tiktokService: {} }));
jest.mock('../jobs/tiktokVideoJob', () => ({ enqueueTikTokVideoUpload: jest.fn() }));
jest.mock('../lib/redis', () => ({ saveOAuthState: jest.fn(), consumeOAuthState: jest.fn() }));

describe('#1778 readBodyCapped', () => {
  it('stops reading and cancels an unbounded stream', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(400).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    });
    const body = await readBodyCapped(new Response(stream), 1000);
    expect(body).toHaveLength(1000);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });
});

describe('#1780 uploadUrlSchema', () => {
  const ok = { videoUrl: 'https://example.com/v.mp4', title: 't' };
  it('accepts valid input', () => expect(uploadUrlSchema.safeParse(ok).success).toBe(true));
  it.each([
    ['file scheme', { ...ok, videoUrl: 'file:///etc/passwd' }],
    ['http scheme', { ...ok, videoUrl: 'http://example.com/v.mp4' }],
    ['too long', { ...ok, videoUrl: 'https://e.com/' + 'a'.repeat(3000) }],
    ['bad privacy', { ...ok, privacyLevel: 'EVERYONE' }],
  ])('rejects %s', (_n, body) => expect(uploadUrlSchema.safeParse(body).success).toBe(false));
});

describe('#1779 config', () => {
  it('fails when Twitter webhook enabled without secret', () => {
    expect(() =>
      validateEnv({ ...(process.env as any), TWITTER_WEBHOOK_ENABLED: 'true', TWITTER_WEBHOOK_SECRET: '' }),
    ).toThrow();
  });
});

describe('SSE ticket validation', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects a ticket id that was never issued', () => {
    jest.useFakeTimers();
    const { sseTicketService } = require('../services/SSETicketService');
    const unknownId = 'never-issued-ticket-id';
    expect(sseTicketService.validateAndConsume(unknownId)).toBeNull();
    // Still rejected on a second attempt: nothing was consumed or accepted.
    expect(sseTicketService.validateAndConsume(unknownId)).toBeNull();
  });

  it('accepts a valid ticket exactly once and rejects reuse', () => {
    jest.useFakeTimers();
    const { sseTicketService } = require('../services/SSETicketService');
    const ticket = sseTicketService.generateTicket('user-1');
    const ticketId = typeof ticket === 'string' ? ticket : ticket.id;

    expect(sseTicketService.validateAndConsume(ticketId)).not.toBeNull();
    expect(sseTicketService.validateAndConsume(ticketId)).toBeNull();
  });
});

describe('#2030 SSE ticket map eviction order', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('evicts the oldest ticket first at the cap and keeps a fresh ticket', () => {
    jest.useFakeTimers();
    const { sseTicketService } = require('../services/SSETicketService');
    const cap: number = (sseTicketService as any).maxTickets ?? (sseTicketService as any).cap;
    expect(typeof cap).toBe('number');

    const oldest = sseTicketService.issueTicket('user-oldest');
    const tickets: string[] = [];
    for (let i = 0; i < cap - 1; i++) {
      tickets.push(sseTicketService.issueTicket(`user-${i}`));
    }
    const fresh = sseTicketService.issueTicket('user-fresh');

    expect(sseTicketService.consumeTicket(oldest)).toBeFalsy();
    expect(sseTicketService.consumeTicket(fresh)).toBeTruthy();
    expect(sseTicketService.consumeTicket(tickets[tickets.length - 1])).toBeTruthy();
  });

  it('sweeps expired tickets before evicting live ones', () => {
    jest.useFakeTimers();
    const { sseTicketService } = require('../services/SSETicketService');
    const cap: number = (sseTicketService as any).maxTickets ?? (sseTicketService as any).cap;
    const ttl: number = (sseTicketService as any).ttlMs ?? (sseTicketService as any).ttl;

    const expired: string[] = [];
    for (let i = 0; i < cap; i++) {
      expired.push(sseTicketService.issueTicket(`expired-${i}`));
    }

    jest.advanceTimersByTime(ttl + 1);

    const live = sseTicketService.issueTicket('live-user');
    sseTicketService.sweep();

    for (const t of expired) {
      expect(sseTicketService.consumeTicket(t)).toBeFalsy();
    }
    expect(sseTicketService.consumeTicket(live)).toBeTruthy();
  });
});

describe('#1984 SSE ticket TTL expiry', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects a ticket after its TTL elapses and the sweep runs', () => {
    jest.useFakeTimers();
    const { SseTicketService } = require('../services/sseTicketService');
    const service = new SseTicketService();
    const ticket = service.issue('user-1');
    expect(service.consume(ticket)).toBeDefined();

    const ticket2 = service.issue('user-2');
    jest.advanceTimersByTime(service.ttlMs + 1);
    service.sweep();

    expect(service.consume(ticket2)).toBeUndefined();
  });

  it('accepts a ticket still within its TTL after a sweep', () => {
    jest.useFakeTimers();
    const { SseTicketService } = require('../services/sseTicketService');
    const service = new SseTicketService();
    const ticket = service.issue('user-1');

    jest.advanceTimersByTime(Math.floor(service.ttlMs / 2));
    service.sweep();

    expect(service.consume(ticket)).toBeDefined();
  });

  it('sweep deletes expired entries from the ticket map', () => {
    jest.useFakeTimers();
    const { SseTicketService } = require('../services/sseTicketService');
    const service = new SseTicketService();
    service.issue('user-1');
    service.issue('user-2');
    const tickets = (service as any).tickets as Map<string, unknown>;
    expect(tickets.size).toBe(2);

    jest.advanceTimersByTime(service.ttlMs + 1);
    service.sweep();

    expect(tickets.size).toBe(0);
  });
});

describe('#1961 SSE ticket map capacity', () => {
  beforeEach(() => {
    jest.resetModules();
    const { sseTicketService } = require('../services/SSETicketService');
    sseTicketService.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects issuance with a clear error once the ticket map is at capacity', () => {
    const { sseTicketService } = require('../services/SSETicketService');
    const cap = sseTicketService.maxTickets;
    expect(typeof cap).toBe('number');
    expect(cap).toBeGreaterThan(0);

    for (let i = 0; i < cap; i++) {
      expect(() => sseTicketService.issue('user-' + i)).not.toThrow();
    }
    expect(sseTicketService.size).toBe(cap);

    let error: unknown;
    expect(() => {
      try {
        sseTicketService.issue('user-overflow');
      } catch (e) {
        error = e;
        throw e;
      }
    }).toThrow();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/capacity|limit|full/i);
    expect(sseTicketService.size).toBe(cap);
  });
});

describe('#1961 SSE ticket cap and sweep behaviour', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps the map at or below the cap, evicting the oldest and retaining the newest', () => {
    jest.useFakeTimers();
    const { sseTicketService } = require('../services/SSETicketService');
    sseTicketService.clear();
    const cap: number = sseTicketService.maxTickets;
    expect(typeof cap).toBe('number');
    expect(cap).toBeGreaterThan(0);

    const issued: string[] = [];
    for (let i = 0; i < cap * 2; i++) {
      issued.push(sseTicketService.issue('user-' + i));
      expect(sseTicketService.size).toBeLessThanOrEqual(cap);
    }

    expect(sseTicketService.size).toBe(cap);
    // Oldest tickets were evicted.
    expect(sseTicketService.consume(issued[0])).toBeUndefined();
    // Newest ticket is still live.
    expect(sseTicketService.consume(issued[issued.length - 1])).toBeDefined();
  });

  it('sweeps expired tickets without waiting for a consume lookup', () => {
    jest.useFakeTimers();
    const { sseTicketService } = require('../services/SSETicketService');
    sseTicketService.clear();
    const ttl: number = sseTicketService.ttlMs;

    sseTicketService.issue('user-1');
    sseTicketService.issue('user-2');
    const tickets = (sseTicketService as any).tickets as Map<string, unknown>;
    expect(tickets.size).toBe(2);

    jest.advanceTimersByTime(ttl + 1);
    sseTicketService.sweep();

    expect(tickets.size).toBe(0);
    expect(sseTicketService.size).toBe(0);
  });

  it('updates the sseTicketsActive gauge to reflect the live ticket count', () => {
    jest.useFakeTimers();
    const metrics = require('../lib/metrics');
    const { sseTicketService } = require('../services/SSETicketService');
    sseTicketService.clear();

    const gauge = metrics.sseTicketsActive;
    expect(gauge).toBeDefined();

    sseTicketService.issue('user-1');
    sseTicketService.issue('user-2');
    expect(sseTicketService.size).toBe(2);
    if (typeof gauge?.set === 'function') {
      expect(gauge.set).toHaveBeenLastCalledWith(2);
    }

    jest.advanceTimersByTime(sseTicketService.ttlMs + 1);
    sseTicketService.sweep();
    expect(sseTicketService.size).toBe(0);
    if (typeof gauge?.set === 'function') {
      expect(gauge.set).toHaveBeenLastCalledWith(0);
    }
  });
});

describe('#2046 SSE ticket sweep interval teardown', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('clears the sweep interval on teardown and leaves no active timers', () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    const { sseTicketService } = require('../services/SSETicketService');
    sseTicketService.startSweep();
    expect(setIntervalSpy).toHaveBeenCalled();
    const sweepHandle = setIntervalSpy.mock.results[setIntervalSpy.mock.results.length - 1].value;
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    sseTicketService.stopSweep();

    expect(clearIntervalSpy).toHaveBeenCalledWith(sweepHandle);
    expect(jest.getTimerCount()).toBe(0);
  });
});
