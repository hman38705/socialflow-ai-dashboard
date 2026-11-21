/**
 * eventBus.ts — In-process pub/sub event bus and SSE ticket service.
 *
 * Provides a lightweight typed event bus for fan-out of domain events to
 * in-process subscribers, plus a short-lived ticket service used to
 * authenticate Server-Sent Events (SSE) connections without exposing the
 * access token in the query string.
 *
 * Tickets are single-use and expire after a TTL. The ticket map is bounded by
 * a configurable maximum size; when the cap is reached the oldest entries are
 * evicted first (Map preserves insertion order).
 */
import { randomBytes } from 'crypto';
import { config } from '../config/config';
import { createLogger } from './logger';

const log = createLogger('eventBus');

// ---------------------------------------------------------------------------
// Typed event bus
// ---------------------------------------------------------------------------
export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as EventHandler);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<T = unknown>(event: string, payload: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        log.error('event handler threw', { event, error: (err as Error).message });
      }
    }
  }
}

export const eventBus = new EventBus();

// ---------------------------------------------------------------------------
// SSE ticket service
// ---------------------------------------------------------------------------
interface TicketEntry {
  userId: string;
  expiresAt: number;
}

const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = config.SSE_TICKET_MAX_SIZE;

const tickets = new Map<string, TicketEntry>();

/**
 * Issue a single-use ticket bound to a user. Tickets are stored in insertion
 * order; when the map exceeds the configured cap the oldest entries are
 * evicted first.
 */
export const issueTicket = (userId: string): string => {
  const ticket = randomBytes(24).toString('hex');
  tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });

  if (tickets.size > MAX_TICKETS) {
    const overflow = tickets.size - MAX_TICKETS;
    let evicted = 0;
    for (const key of tickets.keys()) {
      if (evicted >= overflow) break;
      tickets.delete(key);
      evicted++;
    }
    log.warn('SSE ticket map cap reached, evicted oldest entries', {
      cap: MAX_TICKETS,
      evicted,
    });
  }

  return ticket;
};

/**
 * Consume a ticket, returning the bound user ID if the ticket is valid and
 * unexpired. Tickets are single-use: a successful consume removes the entry.
 */
export const consumeTicket = (ticket: string): string | null => {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
};

/**
 * Sweep expired tickets. Called periodically to keep the map tidy between
 * evictions.
 */
export const sweepExpiredTickets = (): void => {
  const now = Date.now();
  for (const [key, entry] of tickets) {
    if (entry.expiresAt < now) tickets.delete(key);
  }
};

/** Exposed for tests: current number of stored tickets. */
export const ticketCount = (): number => tickets.size;
