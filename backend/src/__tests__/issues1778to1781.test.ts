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
