import 'reflect-metadata';
import { injectable } from 'inversify';
import CircuitBreaker from 'opossum';
import {
  CircuitBreakerConfig,
  CIRCUIT_CONFIGS,
  FALLBACK_STRATEGIES,
} from '../config/circuitBreaker.config';
import { createLogger } from '../lib/logger';
import { createNotificationManager } from './notificationProvider';

const logger = createLogger('circuit-breaker');
const notificationManager = createNotificationManager();

/**
 * Circuit Breaker State
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit Breaker Statistics
 */
export interface CircuitStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  rejects: number;
  fires: number;
  fallbacks: number;
  latency: {
    mean: number;
    median: number;
    p95: number;
    p99: number;
  };
}

/**
 * Circuit Breaker Service
 *
 * Wraps external API calls with circuit breaker pattern to prevent
 * cascading failures when external services are down.
 *
 * Features:
 * - Automatic failure detection and circuit opening
 * - Configurable thresholds per service type
 * - Fallback strategies
 * - Real-time monitoring and statistics
 * - Health check integration
 */
@injectable()
class CircuitBreakerService {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private fallbackHandlers: Map<string, (...args: unknown[]) => unknown> = new Map();

  /**
   * Create or get a circuit breaker for a service
   */
  public getBreaker(
    serviceName: keyof typeof CIRCUIT_CONFIGS,
    customConfig?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker {
    const existingBreaker = this.breakers.get(serviceName);
    if (existingBreaker) {
      return existingBreaker;
    }

    const config = {
      ...CIRCUIT_CONFIGS[serviceName],
      ...customConfig,
    };

    const breaker = new CircuitBreaker(
      async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
        return await fn(...args);
      },
      {
        timeout: config.timeout,
        errorThresholdPercentage: config.errorThresholdPercentage,
        resetTimeout: config.resetTimeout,
        rollingCountTimeout: config.rollingCountTimeout,
        rollingCountBuckets: config.rollingCountBuckets,
        volumeThreshold: config.volumeThreshold,
        name: config.name,
      },
    );

    // Setup event listeners for monitoring
    this.setupEventListeners(breaker, serviceName);

    this.breakers.set(serviceName, breaker);
    return breaker;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  public async execute<T>(
    serviceName: keyof typeof CIRCUIT_CONFIGS,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    const breaker = this.getBreaker(serviceName);

    try {
      return (await breaker.fire(fn)) as T;
    } catch (error) {
      // Circuit is open or function failed
      if (fallback) {
        logger.warn(`Circuit breaker fallback triggered for ${serviceName}`);
        return await fallback();
      }

      // Check if we have a registered fallback handler
      const registeredFallback = this.fallbackHandlers.get(serviceName);
      if (registeredFallback) {
        return (await registeredFallback(error)) as T;
      }

      // Use default fallback strategy
      const strategy = (FALLBACK_STRATEGIES as Record<string, { enabled: boolean; message: string }>)[serviceName];
      if (strategy?.enabled) {
        throw new CircuitBreakerError(serviceName, strategy.message, error);
      }

      throw error;
    }
  }

  /**
   * Register a fallback handler for a service
   */
  public registerFallback(
    serviceName: keyof typeof CIRCUIT_CONFIGS,
    handler: (...args: unknown[]) => unknown,
  ): void {
    this.fallbackHandlers.set(serviceName, handler);
  }

  /**
   * Get circuit breaker statistics
   */
  public getStats(serviceName?: keyof typeof CIRCUIT_CONFIGS): CircuitStats | CircuitStats[] {
    if (serviceName) {
      const breaker = this.breakers.get(serviceName);
      if (!breaker) {
        throw new Error(`Circuit breaker not found: ${serviceName}`);
      }
      return this.extractStats(breaker, serviceName);
    }

    // Return all stats
    const allStats: CircuitStats[] = [];
    this.breakers.forEach((breaker, name) => {
      allStats.push(this.extractStats(breaker, name));
    });
    return allStats;
  }

  /**
   * Extract statistics from a circuit breaker
   */
  private extractStats(breaker: CircuitBreaker, name: string): CircuitStats {
    const stats = breaker.stats;
    const latencyTimes: number[] = (stats as any).latencyTimes ?? [];
    const sorted = [...latencyTimes].sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    const pct = (p: number) => sorted.length ? sorted[Math.floor(sorted.length * p)] ?? 0 : 0;

    return {
      name,
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      failures: stats.failures || 0,
      successes: stats.successes || 0,
      rejects: stats.rejects || 0,
      fires: stats.fires || 0,
      fallbacks: stats.fallbacks || 0,
      latency: { mean, median: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
    };
  }

  /**
   * Setup event listeners for monitoring
   */
  private setupEventListeners(breaker: CircuitBreaker, serviceName: string): void {
    breaker.on('open', () => {
      logger.warn(`Circuit breaker OPENED for ${serviceName}`);
      notificationManager.sendAlert({
        severity: 'critical',
        service: serviceName,
        message: `Circuit breaker opened for ${serviceName} — requests are being rejected`,
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logger.error(`Failed to send circuit breaker open alert for ${serviceName}: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    breaker.on('halfOpen', () => {
      logger.info(`Circuit breaker HALF-OPEN for ${serviceName}`);
    });

    breaker.on('close', () => {
      logger.info(`Circuit breaker CLOSED for ${serviceName}`);
    });

    breaker.on('failure', (error) => {
      logger.error(`Circuit breaker failure for ${serviceName}: ${error.message}`);
    });

    breaker.on('success', () => {
      logger.debug(`Circuit breaker success for ${serviceName}`);
    });

    breaker.on('timeout', () => {
      logger.warn(`Circuit breaker timeout for ${serviceName}`);
    });

    breaker.on('reject', () => {
      logger.warn(`Circuit breaker rejected request for ${serviceName} (circuit is open)`);
    });

    breaker.on('fallback', () => {
      logger.info(`Circuit breaker fallback triggered for ${serviceName}`);
    });
  }

  /**
   * Manually open a circuit breaker
   */
  public open(serviceName: keyof typeof CIRCUIT_CONFIGS): void {
    const breaker = this.breakers.get(serviceName);
    if (breaker) {
      breaker.open();
    }
  }

  /**
   * Manually close a circuit breaker
   */
  public close(serviceName: keyof typeof CIRCUIT_CONFIGS): void {
    const breaker = this.breakers.get(serviceName);
    if (breaker) {
      breaker.close();
    }
  }

  /**
   * Check if a circuit is open
   */
  public isOpen(serviceName: keyof typeof CIRCUIT_CONFIGS): boolean {
    const breaker = this.breakers.get(serviceName);
    return breaker ? breaker.opened : false;
  }

  /**
   * Reset all circuit breakers
   */
  public resetAll(): void {
    this.breakers.forEach((breaker) => {
      breaker.close();
      breaker.clearCache();
    });
  }

  /**
   * Shutdown all circuit breakers
   */
  public shutdown(): void {
    this.breakers.forEach((breaker) => {
      breaker.shutdown();
    });
    this.breakers.clear();
    this.fallbackHandlers.clear();
  }
}

/**
 * Custom error for circuit breaker failures
 */
export class CircuitBreakerError extends Error {
  constructor(
    public serviceName: string,
    message: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

// Singleton instance
export const circuitBreakerService = new CircuitBreakerService();
export { CircuitBreakerService };
