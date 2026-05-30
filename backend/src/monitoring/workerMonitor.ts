import { ConnectionOptions, Queue, QueueEvents, Worker } from 'bullmq';

export interface MonitorAlert {
  severity: 'warning' | 'critical';
  code:
    | 'WORKER_STALLED'
    | 'WORKER_RESTARTED'
    | 'QUEUE_LATENCY_HIGH'
    | 'JOB_STUCK_ACTIVE'
    | 'RECOVERY_RETRY_TRIGGERED'
    | 'RECOVERY_RETRY_FAILED'
    | 'MONITOR_ERROR';
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface WorkerMonitorOptions {
  connection: ConnectionOptions;
  monitorIntervalMs?: number;
  latencyThresholdMs?: number;
  stuckJobThresholdMs?: number;
  maxRestartsPerHour?: number;
  maxRecoveryAttempts?: number;
  restartBackoffBaseMs?: number;
  restartBackoffMaxMs?: number;
  retryableFailurePatterns?: RegExp[];
  alertHandler?: (alert: MonitorAlert) => Promise<void> | void;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface QueueRuntimeMetrics {
  queueName: string;
  waitingCount: number;
  activeCount: number;
  failedCount: number;
  stalledEvents: number;
  highLatencyEvents: number;
  stuckActiveEvents: number;
  oldestWaitingLatencyMs: number;
  lastCheckedAt?: string;
  lastStalledAt?: string;
  lastHighLatencyAt?: string;
  lastStuckActiveAt?: string;
}

export interface WorkerRuntimeMetrics {
  workerName: string;
  queueName: string;
  restartCount: number;
  lastRestartAt?: string;
  restartDeniedCount: number;
  healthy: boolean;
}

interface RegisteredWorker {
  workerName: string;
  queueName: string;
  factory: () => Worker;
  worker?: Worker;
  restartHistory: number[];
  restartDeniedCount: number;
  restartCount: number;
  lastRestartAt?: string;
  listenerAttached: boolean;
  lastErrorMessage?: string;
  consecutiveRestarts: number;
  lastRestartTimestamp?: number;
}

interface MonitoredQueue {
  queueName: string;
  queue: Queue;
  events: QueueEvents;
  stalledEvents: number;
  highLatencyEvents: number;
  stuckActiveEvents: number;
  lastCheckedAt?: string;
  lastStalledAt?: string;
  lastHighLatencyAt?: string;
  lastStuckActiveAt?: string;
}

const DEFAULT_MONITOR_INTERVAL_MS = 30000;
const DEFAULT_LATENCY_THRESHOLD_MS = 60000;
const DEFAULT_STUCK_JOB_THRESHOLD_MS = 300000;
const DEFAULT_MAX_RESTARTS_PER_HOUR = 3;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 5;
const DEFAULT_RESTART_BACKOFF_BASE_MS = 1000;
const DEFAULT_RESTART_BACKOFF_MAX_MS = 60000;
const HOUR_MS = 60 * 60 * 1000;
const RESTART_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes to reset consecutive counter
const MAX_BACKOFF_MS = 5 * 60 * 1000; // hard cap: never wait more than 5 minutes between restarts

export class WorkerMonitor {
  private readonly options: Required<Omit<WorkerMonitorOptions, 'connection'>> & {
    connection: ConnectionOptions;
  };

  private readonly queues = new Map<string, MonitoredQueue>();
  private readonly workers = new Map<string, RegisteredWorker>();
  private monitorTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: WorkerMonitorOptions) {
    this.options = {
      connection: options.connection,
      monitorIntervalMs: options.monitorIntervalMs ?? DEFAULT_MONITOR_INTERVAL_MS,
      latencyThresholdMs: options.latencyThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS,
      stuckJobThresholdMs: options.stuckJobThresholdMs ?? DEFAULT_STUCK_JOB_THRESHOLD_MS,
      maxRestartsPerHour: options.maxRestartsPerHour ?? DEFAULT_MAX_RESTARTS_PER_HOUR,
      maxRecoveryAttempts: options.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS,
      restartBackoffBaseMs: options.restartBackoffBaseMs ?? DEFAULT_RESTART_BACKOFF_BASE_MS,
      restartBackoffMaxMs: options.restartBackoffMaxMs ?? DEFAULT_RESTART_BACKOFF_MAX_MS,
      retryableFailurePatterns: options.retryableFailurePatterns ?? [
        /stalled/i,
        /timeout/i,
        /connection/i,
        /econnreset/i,
        /etimedout/i,
      ],
      alertHandler: options.alertHandler ?? (() => undefined),
      logger: options.logger ?? console,
    };
  }

  public registerQueue(queueName: string, queue?: Queue): void {
    if (this.queues.has(queueName)) {
      return;
    }

    const monitoredQueue: MonitoredQueue = {
      queueName,
      queue: queue ?? new Queue(queueName, { connection: this.options.connection }),
      events: new QueueEvents(queueName, { connection: this.options.connection }),
      stalledEvents: 0,
      highLatencyEvents: 0,
      stuckActiveEvents: 0,
    };

    monitoredQueue.events.on('stalled', async ({ jobId }) => {
      monitoredQueue.stalledEvents += 1;
      monitoredQueue.lastStalledAt = new Date().toISOString();

      await this.sendAlert({
        severity: 'critical',
        code: 'WORKER_STALLED',
        message: `Detected stalled BullMQ job in queue ${queueName}`,
        metadata: { queueName, jobId },
      });

      await this.restartWorkersForQueue(queueName, {
        reason: `stalled job detected: ${String(jobId)}`,
      });
    });

    monitoredQueue.events.on('failed', async ({ jobId, failedReason, prev }) => {
      const reason = failedReason ?? 'unknown';
      const isRetryable = this.options.retryableFailurePatterns.some((pattern) =>
        pattern.test(reason),
      );

      if (!isRetryable) {
        return;
      }

      try {
        const job = await monitoredQueue.queue.getJob(jobId);
        if (!job) {
          return;
        }

        if (job.attemptsMade >= this.options.maxRecoveryAttempts) {
          return;
        }

        await job.retry();

        await this.sendAlert({
          severity: 'warning',
          code: 'RECOVERY_RETRY_TRIGGERED',
          message: `Auto-retry triggered for queue ${queueName}`,
          metadata: {
            queueName,
            jobId,
            failedReason: reason,
            previousState: prev,
            attemptsMade: job.attemptsMade,
          },
        });
      } catch (error) {
        await this.sendAlert({
          severity: 'critical',
          code: 'RECOVERY_RETRY_FAILED',
          message: `Auto-retry failed for queue ${queueName}`,
          metadata: {
            queueName,
            jobId,
            failedReason: reason,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    this.queues.set(queueName, monitoredQueue);
  }

  public registerWorker(workerName: string, queueName: string, factory: () => Worker): void {
    this.registerQueue(queueName);

    this.workers.set(workerName, {
      workerName,
      queueName,
      factory,
      restartHistory: [],
      restartDeniedCount: 0,
      restartCount: 0,
      listenerAttached: false,
      consecutiveRestarts: 0,
    });

    if (this.running) {
      void this.ensureWorkerStarted(workerName);
    }
  }

  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    for (const queue of this.queues.values()) {
      await queue.events.waitUntilReady();
    }

    for (const workerName of this.workers.keys()) {
      await this.ensureWorkerStarted(workerName);
    }

    await this.checkQueues();

    this.monitorTimer = setInterval(() => {
      void this.checkQueues();
    }, this.options.monitorIntervalMs);

    this.options.logger.info('[worker-monitor] Worker monitor started');
  }

  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    for (const worker of this.workers.values()) {
      if (worker.worker) {
        await worker.worker.close();
      }
    }

    for (const queue of this.queues.values()) {
      await queue.events.close();
      await queue.queue.close();
    }

    this.options.logger.info('[worker-monitor] Worker monitor stopped');
  }

  public getStatus(): {
    running: boolean;
    queues: QueueRuntimeMetrics[];
    workers: WorkerRuntimeMetrics[];
  } {
    const queueStatus = Array.from(this.queues.values()).map((queue) => {
      return {
        queueName: queue.queueName,
        waitingCount: 0,
        activeCount: 0,
        failedCount: 0,
        stalledEvents: queue.stalledEvents,
        highLatencyEvents: queue.highLatencyEvents,
        stuckActiveEvents: queue.stuckActiveEvents,
        oldestWaitingLatencyMs: 0,
        lastCheckedAt: queue.lastCheckedAt,
        lastStalledAt: queue.lastStalledAt,
        lastHighLatencyAt: queue.lastHighLatencyAt,
        lastStuckActiveAt: queue.lastStuckActiveAt,
      };
    });

    const workerStatus = Array.from(this.workers.values()).map((worker) => {
      return {
        workerName: worker.workerName,
        queueName: worker.queueName,
        restartCount: worker.restartCount,
        lastRestartAt: worker.lastRestartAt,
        restartDeniedCount: worker.restartDeniedCount,
        healthy: Boolean(worker.worker),
      };
    });

    return {
      running: this.running,
      queues: queueStatus,
      workers: workerStatus,
    };
  }

  private async ensureWorkerStarted(workerName: string): Promise<void> {
    const worker = this.workers.get(workerName);
    if (!worker) {
      return;
    }

    if (!worker.worker) {
      worker.worker = worker.factory();
      this.attachWorkerListeners(worker);
      await worker.worker.waitUntilReady();
    }
  }

  private attachWorkerListeners(worker: RegisteredWorker): void {
    if (!worker.worker || worker.listenerAttached) {
      return;
    }

    const errorListener = async (error: Error): Promise<void> => {
      await this.sendAlert({
        severity: 'critical',
        code: 'MONITOR_ERROR',
        message: `Worker ${worker.workerName} emitted an error`,
        metadata: {
          workerName: worker.workerName,
          queueName: worker.queueName,
          error: error.message,
        },
      });

      worker.lastErrorMessage = error.message;

      await this.restartWorker(worker.workerName, {
        reason: `worker error: ${error.message}`,
        lastErrorMessage: error.message,
      });
    };

    worker.worker.on('error', errorListener);
    worker.listenerAttached = true;
  }

  private async checkQueues(): Promise<void> {
    for (const queue of this.queues.values()) {
      try {
        const [waitingCount, activeCount, failedCount, waitingJobs, activeJobs] = await Promise.all(
          [
            queue.queue.getWaitingCount(),
            queue.queue.getActiveCount(),
            queue.queue.getFailedCount(),
            queue.queue.getWaiting(0, 0),
            queue.queue.getActive(0, 100),
          ],
        );

        queue.lastCheckedAt = new Date().toISOString();

        let oldestWaitingLatencyMs = 0;
        const oldestWaiting = waitingJobs[0];
        if (oldestWaiting?.timestamp) {
          oldestWaitingLatencyMs = Date.now() - oldestWaiting.timestamp;
        }

        if (oldestWaitingLatencyMs > this.options.latencyThresholdMs) {
          queue.highLatencyEvents += 1;
          queue.lastHighLatencyAt = new Date().toISOString();
          await this.sendAlert({
            severity: 'warning',
            code: 'QUEUE_LATENCY_HIGH',
            message: `Queue latency high for ${queue.queueName}`,
            metadata: {
              queueName: queue.queueName,
              waitingCount,
              activeCount,
              failedCount,
              oldestWaitingLatencyMs,
              thresholdMs: this.options.latencyThresholdMs,
            },
          });
        }

        const stuckJobs = activeJobs.filter((job) => {
          const startedAt = job.processedOn ?? job.timestamp;
          return Date.now() - startedAt > this.options.stuckJobThresholdMs;
        });

        if (stuckJobs.length > 0) {
          queue.stuckActiveEvents += 1;
          queue.lastStuckActiveAt = new Date().toISOString();

          await this.sendAlert({
            severity: 'critical',
            code: 'JOB_STUCK_ACTIVE',
            message: `Detected stuck active jobs for queue ${queue.queueName}`,
            metadata: {
              queueName: queue.queueName,
              stuckJobIds: stuckJobs.map((job) => job.id),
              stuckJobThresholdMs: this.options.stuckJobThresholdMs,
            },
          });

          await this.restartWorkersForQueue(queue.queueName, {
            reason: 'stuck active jobs detected',
          });
        }
      } catch (error) {
        await this.sendAlert({
          severity: 'critical',
          code: 'MONITOR_ERROR',
          message: `Failed while checking queue ${queue.queueName}`,
          metadata: {
            queueName: queue.queueName,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  private async restartWorkersForQueue(
    queueName: string,
    context: { reason: string; lastErrorMessage?: string },
  ): Promise<void> {
    const workerNames = Array.from(this.workers.values())
      .filter((worker) => worker.queueName === queueName)
      .map((worker) => worker.workerName);

    for (const workerName of workerNames) {
      await this.restartWorker(workerName, context);
    }
  }

  private async restartWorker(
    workerName: string,
    context: { reason: string; lastErrorMessage?: string },
  ): Promise<void> {
    const worker = this.workers.get(workerName);
    if (!worker) {
      return;
    }

    const lastErrorMessage = context.lastErrorMessage ?? worker.lastErrorMessage;

    const now = Date.now();
    worker.restartHistory = worker.restartHistory.filter((timestamp) => now - timestamp <= HOUR_MS);

    if (worker.restartHistory.length >= this.options.maxRestartsPerHour) {
      worker.restartDeniedCount += 1;
      await this.sendAlert({
        severity: 'critical',
        code: 'MONITOR_ERROR',
        message: `Restart denied by safety limit for worker ${workerName}`,
        metadata: {
          workerName,
          queueName: worker.queueName,
          reason: context.reason,
          lastErrorMessage,
          maxRestartsPerHour: this.options.maxRestartsPerHour,
        },
      });
      return;
    }

    // Reset consecutive restarts if enough time has passed
    if (
      worker.lastRestartTimestamp &&
      now - worker.lastRestartTimestamp > RESTART_COOLDOWN_MS
    ) {
      worker.consecutiveRestarts = 0;
    }

    // Calculate exponential backoff delay, capped at MAX_BACKOFF_MS regardless of configuration
    const backoffDelay = Math.min(
      Math.pow(2, worker.consecutiveRestarts) * this.options.restartBackoffBaseMs,
      this.options.restartBackoffMaxMs,
      MAX_BACKOFF_MS,
    );

    if (backoffDelay > 0) {
      this.options.logger.info(
        `[worker-monitor] Applying backoff delay of ${backoffDelay}ms before restarting ${workerName} (attempt ${worker.consecutiveRestarts + 1})`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }

    try {
      if (worker.worker) {
        await worker.worker.close();
      }
    } catch (error) {
      this.options.logger.error(
        `[worker-monitor] Failed to close worker ${workerName} before restart: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    worker.listenerAttached = false;
    worker.worker = worker.factory();
    this.attachWorkerListeners(worker);
    await worker.worker.waitUntilReady();

    worker.restartHistory.push(now);
    worker.restartCount += 1;
    worker.consecutiveRestarts += 1;
    worker.lastRestartTimestamp = now;
    worker.lastRestartAt = new Date(now).toISOString();

    await this.sendAlert({
      severity: 'warning',
      code: 'WORKER_RESTARTED',
      message: `Worker ${workerName} restarted`,
      metadata: {
        workerName,
        queueName: worker.queueName,
        reason: context.reason,
        lastErrorMessage,
        restartCount: worker.restartCount,
        consecutiveRestarts: worker.consecutiveRestarts,
        backoffDelayMs: backoffDelay,
      },
    });
  }

  private async sendAlert(alert: Omit<MonitorAlert, 'timestamp'>): Promise<void> {
    const payload: MonitorAlert = {
      ...alert,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.options.alertHandler(payload);
    } catch (error) {
      this.options.logger.error(
        `[worker-monitor] Alert handler failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (payload.severity === 'critical') {
      this.options.logger.error(
        `[worker-monitor] ${payload.code}: ${payload.message}`,
        payload.metadata ?? {},
      );
      return;
    }

    this.options.logger.warn(
      `[worker-monitor] ${payload.code}: ${payload.message}`,
      payload.metadata ?? {},
    );
  }
}
