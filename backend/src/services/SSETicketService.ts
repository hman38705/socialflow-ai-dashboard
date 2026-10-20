import crypto from 'crypto';
import { createLogger } from '../lib/logger';

const logger = createLogger('SSETicketService');

interface SSETicket {
  userId: string;
  ticket: string;
  expiresAt: number;
  consumed: boolean;
}

/**
 * SSETicketService — Manages short-lived, single-use tickets for SSE connections.
 * 
 * This prevents exposing long-lived JWTs in URLs/query parameters.
 * Tickets are valid for 30 seconds and can only be used once.
 */
class SSETicketService {
  private tickets: Map<string, SSETicket> = new Map();
  private readonly TICKET_TTL_MS = 30_000; // 30 seconds
  private readonly MAX_TICKETS_PER_USER = 5;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired tickets every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  /**
   * Generate a new short-lived SSE ticket for the given user.
   * 
   * @param userId - User ID from JWT payload
   * @returns A single-use ticket string (32 random bytes, hex-encoded)
   */
  generateTicket(userId: string): string {
    const now = Date.now();
    let outstanding = 0;
    for (const entry of this.tickets.values()) {
      if (entry.userId === userId && !entry.consumed && now <= entry.expiresAt) outstanding++;
    }
    if (outstanding >= this.MAX_TICKETS_PER_USER) {
      throw new Error('Too many outstanding SSE tickets');
    }

    const ticket = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.TICKET_TTL_MS;

    this.tickets.set(ticket, {
      userId,
      ticket,
      expiresAt,
      consumed: false,
    });

    logger.debug(`Generated SSE ticket for user ${userId}, expires in ${this.TICKET_TTL_MS}ms`);
    return ticket;
  }

  /**
   * Validate and consume a ticket.
   * 
   * @param ticket - Ticket string to validate
   * @returns userId if valid and unconsumed, null otherwise
   */
  validateAndConsume(ticket: string): string | null {
    const entry = this.tickets.get(ticket);

    if (!entry) {
      logger.warn(`SSE ticket validation failed: ticket not found`);
      return null;
    }

    if (entry.consumed) {
      logger.warn(`SSE ticket validation failed: ticket already consumed`);
      this.tickets.delete(ticket); // Clean up consumed ticket
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      logger.warn(`SSE ticket validation failed: ticket expired`);
      this.tickets.delete(ticket); // Clean up expired ticket
      return null;
    }

    // Mark as consumed and remove immediately
    entry.consumed = true;
    this.tickets.delete(ticket);
    
    logger.debug(`SSE ticket consumed for user ${entry.userId}`);
    return entry.userId;
  }

  /**
   * Clean up expired and consumed tickets.
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [ticket, entry] of this.tickets.entries()) {
      if (entry.consumed || now > entry.expiresAt) {
        this.tickets.delete(ticket);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired/consumed SSE tickets`);
    }
  }

  /**
   * Stop the cleanup timer and clear all tickets (tests/shutdown).
   */
  stop(): void {
    this.shutdown();
  }

  /**
   * Shutdown the service and clear all tickets.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tickets.clear();
    logger.info('SSETicketService shutdown complete');
  }

  /**
   * Get current ticket count (for monitoring/debugging).
   */
  getTicketCount(): number {
    return this.tickets.size;
  }
}

// Singleton instance
export const sseTicketService = new SSETicketService();

// Graceful shutdown
process.on('SIGTERM', () => {
  sseTicketService.shutdown();
});

process.on('SIGINT', () => {
  sseTicketService.shutdown();
});
