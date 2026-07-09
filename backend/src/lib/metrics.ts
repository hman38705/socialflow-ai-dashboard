import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import { createLogger } from './logger';

const logger = createLogger('metrics');

export const register = new Registry();

collectDefaultMetrics({ register });

/**
 * Event loop lag gauge — sampled every 500 ms.
 * Measures the delta between when a setTimeout(fn, 0) was scheduled and when it fired.
 * High values (>100 ms) indicate the event loop is blocked.
 */
export const eventLoopLag = new Gauge({
  name: 'nodejs_event_loop_lag_ms',
  help: 'Current event loop lag in milliseconds',
  registers: [register],
});

(function sampleEventLoopLag() {
  const interval = setInterval(() => {
    const start = Date.now();
    setImmediate(() => eventLoopLag.set(Date.now() - start));
  }, 500);
  // Allow the process to exit cleanly even if this timer is still running
  interval.unref();
})();

/**
 * SLI buckets (ms) covering health (<200ms p95), general (<500ms p95), AI (<2s p95).
 */
const buckets = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds (2xx/3xx only)',
  labelNames: ['method', 'route', 'status_code', 'category'] as const,
  buckets,
  registers: [register],
});

export const errorRequestDuration = new Histogram({
  name: 'http_error_request_duration_ms',
  help: 'HTTP request duration in milliseconds for 5xx error responses',
  labelNames: ['method', 'route', 'status_code', 'category'] as const,
  buckets,
  registers: [register],
});

export const sliBreachTotal = new Counter({
  name: 'sli_breach_total',
  help: 'Total number of SLI budget breaches',
  labelNames: ['category', 'percentile'] as const,
  registers: [register],
});

/**
 * Tracks degraded optional capabilities.
 * Label `capability` matches the integration/component name.
 * Value 1 = degraded (disabled/missing), 0 = fully operational.
 */
export const degradedCapabilities = new Gauge({
  name: 'app_degraded_capabilities',
  help: 'Optional capabilities running in degraded mode (1 = degraded, 0 = ok)',
  labelNames: ['capability'] as const,
  registers: [register],
});

/**
 * SLI budgets per endpoint category (milliseconds).
 * p95 / p99 targets per issue requirements.
 */
export const SLI_BUDGETS: Record<string, { p95: number; p99: number }> = {
  health: { p95: 200, p99: 500 },
  auth:   { p95: 500, p99: 1000 },
  ai:     { p95: 2000, p99: 3000 },
  general: { p95: 500, p99: 1000 },
};

/**
 * BullMQ queue depth gauge — waiting job count per queue.
 * Scraped by Prometheus via /metrics and mapped to the custom metric
 * `bullmq_queue_waiting` by the Prometheus Adapter for HPA scaling.
 */
export const bullmqQueueWaiting = new Gauge({
  name: 'bullmq_queue_waiting',
  help: 'Number of waiting jobs in each BullMQ queue',
  labelNames: ['queue'] as const,
  registers: [register],
});

/**
 * Data pruning job counters — incremented after each pruning run.
 * Used for alerting and compliance tracking.
 */
export const filesPrunedTotal = new Counter({
  name: 'files_pruned_total',
  help: 'Total number of files deleted by the data pruning job',
  registers: [register],
});

export const filesArchivedTotal = new Counter({
  name: 'files_archived_total',
  help: 'Total number of files archived by the data pruning job',
  registers: [register],
});

export const dataPruningErrorsTotal = new Counter({
  name: 'data_pruning_errors_total',
  help: 'Total number of data pruning job runs that failed with an error',
  registers: [register],
});

export const webhookDispatchFailed = new Counter({
  name: 'webhook_dispatch_failed_total',
  help: 'Total number of webhook delivery attempts that failed with an unexpected dispatcher error',
  labelNames: ['subscription_id'] as const,
  registers: [register],
});

/** Map a request path to an SLI category. */
export function resolveCategory(path: string): string {
  if (/^\/(health|status)/.test(path) || /\/health/.test(path)) return 'health';
  if (/\/auth/.test(path)) return 'auth';
  if (/\/(ai|tts|translation)/.test(path)) return 'ai';
  logger.warn(`resolveCategory: unmapped route prefix — falling back to "general"`, { path });
  return 'general';
}
