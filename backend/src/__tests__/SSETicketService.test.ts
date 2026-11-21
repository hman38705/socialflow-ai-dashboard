import { jest } from '@jest/globals';

// Mock Redis and logger before importing the service so the module picks up the stubs.
jest.mock('../services/redis', () => ({
  redis: {
    set: jest.fn(async () => 'OK'),
    get: jest.fn(async () => null),
    del: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { SSETicketService } from '../services/SSETicketService';

describe('SSETicketService TTL and sweep', () => {
  const TICKET_TTL_S = 60;
  const SWEEP_INTERVAL_MS = 30_000;

  let service: SSETicketService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SSETicketService({
      ttlSeconds: TICKET_TTL_S,
      sweepIntervalMs: SWEEP_INTERVAL_MS,
    });
  });

  afterEach(() => {
    service.shutdown();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('rejects a ticket older than the configured TTL on redemption', async () => {
    const ticket = await service.issue('user-1');

    // Advance past the TTL.
    jest.advanceTimersByTime((TICKET_TTL_S + 1) * 1000);

    const result = await service.validateAndConsume(ticket);
    expect(result).toBeNull();
  });

  it('accepts a fresh ticket within the TTL', async () => {
    const ticket = await service.issue('user-1');

    // Advance but stay within the TTL.
    jest.advanceTimersByTime((TICKET_TTL_S - 1) * 1000);

    const result = await service.validateAndConsume(ticket);
    expect(result).not.toBeNull();
  });

  it('sweep removes expired tickets and leaves fresh ones intact', async () => {
    const expiredTicket = await service.issue('user-expired');

    // Advance past the TTL so the first ticket is expired.
    jest.advanceTimersByTime((TICKET_TTL_S + 1) * 1000);

    const freshTicket = await service.issue('user-fresh');

    // Trigger the sweep.
    jest.advanceTimersByTime(SWEEP_INTERVAL_MS);

    // The expired ticket should be gone.
    const expiredResult = await service.validateAndConsume(expiredTicket);
    expect(expiredResult).toBeNull();

    // The fresh ticket should still be valid.
    const freshResult = await service.validateAndConsume(freshTicket);
    expect(freshResult).not.toBeNull();
  });

  it('issues a ticket and looks it up while valid', () => {
    const ticket = service.issueTicket('user-1');

    expect(ticket).toBeTruthy();
    expect(service.consumeTicket(ticket)).toBe('user-1');
  });

  it('rejects a ticket after its TTL elapses', () => {
    const ticket = service.issueTicket('user-1');

    jest.advanceTimersByTime(service.getTtlMs() + 1);

    expect(service.consumeTicket(ticket)).toBeNull();
  });

  it('sweeps expired entries and leaves live ones intact', () => {
    const expired = service.issueTicket('user-expired');

    jest.advanceTimersByTime(service.getTtlMs() + 1);

    const live = service.issueTicket('user-live');

    service.sweep();

    expect(service.consumeTicket(expired)).toBeNull();
    expect(service.consumeTicket(live)).toBe('user-live');
  });

  it('clears the sweep interval on shutdown', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    service.shutdown();

    expect(clearIntervalSpy).toHaveBeenCalled();

    // After shutdown, advancing timers should not throw or run sweeps.
    expect(() => jest.advanceTimersByTime(SWEEP_INTERVAL_MS * 2)).not.toThrow();

    clearIntervalSpy.mockRestore();
  });
});
