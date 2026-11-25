import { randomBytes } from 'crypto';
import { config } from '../config/config';
import { setGauge } from '../lib/metrics';

/**
 * SSE ticket service.
 *
 * Issues short-lived, single-use tickets that clients present when opening an
 * SSE stream. Tickets are swept periodically so abandoned entries do not
 * accumulate. The sweep interval is unref'd so it never keeps the Node event
 * loop alive during shutdown.
 */

export interface SseTicket {
  ticket: string;
  userId: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_SWEEP_INTERVAL_MS = 10_000;
const DEFAULT_MAX_TICKETS = 10_000;

function resolveMaxTickets(): number {
  const configured = (config as { sseMaxTickets?: number }).sseMaxTickets;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_MAX_TICKETS;
}

export class SseTicketService {
  private readonly tickets = new Map<string, SseTicket>();
  readonly ttlMs: number;
  readonly sweepIntervalMs: number;
  readonly maxTickets: number;
  private sweepInterval: NodeJS.Timeout | undefined;

  constructor(
    ttlMs: number = DEFAULT_TTL_MS,
    sweepIntervalMs: number = DEFAULT_SWEEP_INTERVAL_MS,
    maxTickets: number = resolveMaxTickets(),
  ) {
    this.ttlMs = ttlMs;
    this.sweepIntervalMs = sweepIntervalMs;
    this.maxTickets = maxTickets > 0 ? Math.floor(maxTickets) : DEFAULT_MAX_TICKETS;
    this.start();
  }

  /**
   * Starts the sweep timer. Idempotent: repeated calls (or repeated service
   * instantiation sharing this instance) will not create a second interval.
   */
  start(): void {
    if (this.sweepInterval) {
      return;
    }
    this.sweepInterval = setInterval(() => this.sweep(), this.sweepIntervalMs);
    // Never keep the process alive just for the sweep timer.
    this.sweepInterval.unref();
  }

  /** Exposed for tests so they can assert the timer does not hold the loop. */
  getSweepInterval(): NodeJS.Timeout | undefined {
    return this.sweepInterval;
  }
=======

  issue(userId: string): string {
    // Drop dead entries first so they never count against the cap.
    this.sweep();
    // Evict oldest entries (Map preserves insertion order) until there is room.
    while (this.tickets.size >= this.maxTickets) {
      const oldest = this.tickets.keys().next();
      if (oldest.done) {
        break;
      }
      this.tickets.delete(oldest.value);
    }
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, {
      ticket,
      userId,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.updateGauge();
    return ticket;
  }

  consume(ticket: string): SseTicket | undefined {
    const entry = this.tickets.get(ticket);
    if (!entry) {
      return undefined;
    }
    this.tickets.delete(ticket);
    this.updateGauge();
    if (entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry;
  }

  sweep(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt <= now) {
        this.tickets.delete(ticket);
      }
    }
    this.updateGauge();
  }

  /** Current number of live tickets held in the map. */
  size(): number {
    return this.tickets.size;
  }

  private updateGauge(): void {
    setGauge('sseTicketsActive', this.tickets.size);
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }
}
