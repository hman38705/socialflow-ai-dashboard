import 'reflect-metadata';
// Validate all environment variables at startup — throws if any required var is missing/invalid.
import { config } from './config/config';
import app from './app';
import { SocketService } from './services/SocketService';
import { initializeWorkers } from './jobs/workers';
import { startWorkers } from './workers/index';
import { queueManager, closeRedisClient } from './queues/queueManager';
import { startDataPruningJob, stopDataPruningJob } from './jobs/dataPruningJob';
import { startYouTubeSyncJob, stopYouTubeSyncJob } from './jobs/youtubeSyncJob';
import { startTikTokVideoWorker } from './jobs/tiktokVideoJob';
import { startVideoWorker } from './services/VideoService';
import { startTwitterWebhookWorker } from './queues/twitterWebhookQueue';
import { startWorkerMonitor, stopWorkerMonitor } from './monitoring/workerMonitorInstance';
import { startHealthMonitoringJob, stopHealthMonitoringJob } from './jobs/healthMonitoringJob';
import { initializeHealthMonitoring } from './monitoring/healthMonitoringInstance';
import { createLogger } from './lib/logger';
import { prisma } from './lib/prisma';
import { Worker } from 'bullmq';
import { Server } from 'http';
import { createSmsService } from './services/smsService';
import { initialize2FaLockoutStore } from './services/TwoFactorLockoutInit';
import { checkRateLimiterStore } from './middleware/rateLimit';

const logger = createLogger('server');
const PORT = config.BACKEND_PORT;

let serverInstance: Server | null = null;
let webhookWorker: Worker | null = null;
let twitterWebhookWorker: Worker | null = null;
let isShuttingDown = false;

/**
 * Dependencies injectable for testing
 */
export interface ShutdownDeps {
  server: import('http').Server | null;
  webhookWorker: import('bullmq').Worker | null;
  twitterWebhookWorker: import('bullmq').Worker | null;
}

/**
 * Graceful shutdown handler
 * Closes all connections and cleans up resources before exiting
 */
export const gracefulShutdown = async (
  signal: string,
  exitCode: number = 0,
  deps?: ShutdownDeps,
  opts?: { exit?: (code: number) => void; timeoutMs?: number },
): Promise<void> => {
  const doExit = opts?.exit ?? ((code) => process.exit(code));
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const srv = deps?.server ?? serverInstance;
  const ww = deps?.webhookWorker ?? webhookWorker;
  const tww = deps?.twitterWebhookWorker ?? twitterWebhookWorker;

  // Prevent multiple shutdown calls
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring duplicate signal');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Set a timeout to force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded, forcing exit');
    doExit(1);
  }, timeoutMs);

  try {
    // Stop accepting new connections
    if (srv) {
      await new Promise<void>((resolve, reject) => {
        srv.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server', { error: err });
            reject(err);
          } else {
            logger.info('HTTP server closed');
            resolve();
          }
        });
      });
    }

    // Stop worker monitor
    try {
      await stopWorkerMonitor();
      logger.info('Worker monitor stopped');
    } catch (error) {
      logger.error('Failed to stop worker monitor', { error: error instanceof Error ? error.message : String(error) });
    }

    // Stop health monitoring job
    try {
      await stopHealthMonitoringJob();
      logger.info('Health monitoring job stopped');
    } catch (error) {
      logger.error('Failed to stop health monitoring job', { error: error instanceof Error ? error.message : String(error) });
    }

    // Stop webhook delivery worker
    try {
      if (ww) await ww.close();
      logger.info('Webhook worker stopped');
    } catch (error) {
      logger.error('Failed to stop webhook worker', { error: error instanceof Error ? error.message : String(error) });
    }

    // Stop Twitter webhook worker
    try {
      if (tww) await tww.close();
      logger.info('Twitter webhook worker stopped');
    } catch (error) {
      logger.error('Failed to stop Twitter webhook worker', { error: error instanceof Error ? error.message : String(error) });
    }

    // Stop data pruning job
    try {
      await stopDataPruningJob();
      logger.info('Data pruning job stopped');
    } catch (error) {
      logger.error('Failed to stop data pruning job', { error: error instanceof Error ? error.message : String(error) });
    }

    // Stop YouTube sync job
    try {
      await stopYouTubeSyncJob();
      logger.info('YouTube sync job stopped');
    } catch (error) {
      logger.error('Failed to stop YouTube sync job', { error: error instanceof Error ? error.message : String(error) });
    }

    // Close job queues and workers
    try {
      await queueManager.closeAll();
      await closeRedisClient();
      logger.info('All queues and workers closed successfully');
    } catch (error) {
      logger.error('Failed to close queues', { error: error instanceof Error ? error.message : String(error) });
    }

    // Close database connections
    try {
      await prisma.$disconnect();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Failed to close database connections', { error: error instanceof Error ? error.message : String(error) });
    }

    clearTimeout(forceExitTimeout);
    logger.info('Shutdown complete');
    doExit(exitCode);
  } catch (error) {
    clearTimeout(forceExitTimeout);
    logger.error('Error during graceful shutdown', { error: error instanceof Error ? error.message : String(error) });
    doExit(1);
  }
};

/**
 * Global uncaught exception handler
 * Logs the error and initiates graceful shutdown
 */
process.on('uncaughtException', (error: Error) => {
  logger.error('UNCAUGHT EXCEPTION - Application will terminate', {
    error: error.message,
    stack: error.stack,
    name: error.name,
  });

  // Give some time for logs to flush before exiting
  setTimeout(() => {
    void gracefulShutdown('uncaughtException', 1);
  }, 1000);
});

/**
 * Global unhandled promise rejection handler
 * Logs the rejection and initiates graceful shutdown
 */
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('UNHANDLED REJECTION - Application will terminate', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise),
  });

  // Give some time for logs to flush before exiting
  setTimeout(() => {
    void gracefulShutdown('unhandledRejection', 1);
  }, 1000);
});

/**
 * Handle process termination signals
 */
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT', 0);
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM', 0);
});

/**
 * Bootstrap the application
 */
export const bootstrap = async (exit?: (code: number) => void): Promise<void> => {
  const doExit = exit ?? ((code) => process.exit(code));
  try {
    // Initialize SMS service
    createSmsService({
      accountSid: config.TWILIO_ACCOUNT_SID,
      authToken: config.TWILIO_AUTH_TOKEN,
      fromNumber: config.TWILIO_FROM_NUMBER,
    });

    // Verify rate-limiter Redis store is reachable (#916)
    await checkRateLimiterStore(doExit);

    // Initialize 2FA lockout store with Redis backend (#610)
    try {
      initialize2FaLockoutStore();
      logger.info('2FA lockout store initialized');
    } catch (error) {
      logger.error('Failed to initialize 2FA lockout store', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Note: Do not exit on this error; continue with in-memory fallback
    }

    // Initialize job queue workers
    logger.info('Initializing job queue workers...');
    initializeWorkers();
    startWorkers();

    // Initialize health monitoring
    try {
      initializeHealthMonitoring();
      logger.info('Health monitoring initialized');
    } catch (error) {
      logger.error('Failed to initialize health monitoring', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start worker monitor
    try {
      await startWorkerMonitor();
      logger.info('Worker monitor started');
    } catch (error) {
      logger.error('Failed to start worker monitor', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start health monitoring job
    try {
      await startHealthMonitoringJob();
      logger.info('Health monitoring job started');
    } catch (error) {
      logger.error('Failed to start health monitoring job', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start data pruning job
    try {
      await startDataPruningJob();
      logger.info('Data pruning job started');
    } catch (error) {
      logger.error('Failed to start data pruning job', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start YouTube analytics sync job
    try {
      await startYouTubeSyncJob();
      logger.info('YouTube analytics sync job started');
    } catch (error) {
      logger.error('Failed to start YouTube sync job', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start TikTok video upload worker
    try {
      startTikTokVideoWorker();
      logger.info('TikTok video worker started');
    } catch (error) {
      logger.error('Failed to start TikTok video worker', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start video transcoding worker
    try {
      startVideoWorker();
      logger.info('Video transcoding worker started');
    } catch (error) {
      logger.error('Failed to start video transcoding worker', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start Twitter webhook event worker
    try {
      twitterWebhookWorker = startTwitterWebhookWorker();
      logger.info('Twitter webhook worker started');
    } catch (error) {
      logger.error('Failed to start Twitter webhook worker', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Start HTTP server
    serverInstance = app.listen(PORT, () => {
      logger.info(`🚀 SocialFlow Backend is running on http://localhost:${PORT}`);
      logger.info('📬 Job Queue System initialized');
    });

    // Initialize Socket.io
    SocketService.getInstance().initialize(serverInstance);

    // Handle server errors
    serverInstance.on('error', (error: Error) => {
      logger.error('Server error', { error: error.message, stack: error.stack });
    });
  } catch (error) {
    logger.error('Failed to bootstrap application', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    doExit(1);
  }
};

void bootstrap();

// ── Test-only exports ─────────────────────────────────────────────────────────
export const _resetShutdownState = (): void => {
  isShuttingDown = false;
  serverInstance = null;
  webhookWorker = null;
  twitterWebhookWorker = null;
};
