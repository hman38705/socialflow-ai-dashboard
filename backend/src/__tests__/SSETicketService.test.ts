import { SSETicketService } from '../services/SSETicketService';

describe('SSETicketService', () => {
  let service: SSETicketService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SSETicketService();
  });

  afterEach(() => {
    service.shutdown();
    jest.useRealTimers();
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
    clearIntervalSpy.mockRestore();
  });
});
