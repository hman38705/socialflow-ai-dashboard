import { randomBytes } from 'crypto';

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

export class SseTicketService {
  private readonly tickets = new Map<string, SseTicket>();
  private readonly ttlMs: number;
  private readonly sweepIntervalMs: number;
  private sweepInterval: NodeJS.Timeout | undefined;

  constructor(ttlMs: number = DEFAULT_TTL_MS, sweepIntervalMs: number = DEFAULT_SWEEP_INTERVAL_MS) {
    this.ttlMs = ttlMs;
    this.sweepIntervalMs = sweepIntervalMs;
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
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, {
      ticket,
      userId,
      expiresAt: Date.now() + this.ttlMs,
    });
    return ticket;
  }

  consume(ticket: string): SseTicket | undefined {
    const entry = this.tickets.get(ticket);
    if (!entry) {
      return undefined;
    }
    this.tickets.delete(ticket);
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
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }
}
