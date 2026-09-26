jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { sseTicketService } from '../SSETicketService';

describe('SSETicketService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    sseTicketService.shutdown();
  });

  it('issues a 64-char hex ticket and stores it', () => {
    const before = sseTicketService.getTicketCount();
    const ticket = sseTicketService.generateTicket('user-1');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(sseTicketService.getTicketCount()).toBe(before + 1);
  });

  it('issues unique tickets', () => {
    const a = sseTicketService.generateTicket('user-1');
    const b = sseTicketService.generateTicket('user-1');
    expect(a).not.toBe(b);
  });

  it('consumes a valid ticket and returns the userId', () => {
    const ticket = sseTicketService.generateTicket('user-2');
    expect(sseTicketService.validateAndConsume(ticket)).toBe('user-2');
  });

  it('rejects reuse of a consumed ticket', () => {
    const ticket = sseTicketService.generateTicket('user-3');
    expect(sseTicketService.validateAndConsume(ticket)).toBe('user-3');
    expect(sseTicketService.validateAndConsume(ticket)).toBeNull();
  });

  it('rejects unknown or forged tickets', () => {
    expect(sseTicketService.validateAndConsume('f'.repeat(64))).toBeNull();
    expect(sseTicketService.validateAndConsume('')).toBeNull();
  });

  it('rejects an expired ticket and removes it', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const ticket = sseTicketService.generateTicket('user-4');
    const count = sseTicketService.getTicketCount();
    spy.mockReturnValue(now + 30_001);
    expect(sseTicketService.validateAndConsume(ticket)).toBeNull();
    expect(sseTicketService.getTicketCount()).toBe(count - 1);
  });

  it('accepts a ticket right up to its TTL', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const ticket = sseTicketService.generateTicket('user-5');
    spy.mockReturnValue(now + 30_000);
    expect(sseTicketService.validateAndConsume(ticket)).toBe('user-5');
  });

  it('shutdown clears all tickets', () => {
    sseTicketService.generateTicket('user-6');
    sseTicketService.shutdown();
    expect(sseTicketService.getTicketCount()).toBe(0);
  });
});
