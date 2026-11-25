import { Queue } from 'bullmq';
import { getConfiguredQueueNames, getRedisConnection } from '../config/runtime';
import { redis } from '../lib/redis';
import { Logger } from '../lib/logger';
import { auditLogger } from '../lib/audit';
import { KNOWN_QUEUES_SET_KEY } from './constants';

export interface RetryFailedJobsOptions {
  queueName: string;
  limit: number;
  dryRun?: boolean;
  jobId?: string;
  actor?: string;
}

export interface RetryFailedJobsResult {
  queueName: string;
  targetedJobs: number;
  retriedJobs: number;
  failedRetries: Array<{ jobId: string; reason: string }>;
  dryRun: boolean;
}

export const getDiscoveredQueueNames = async (): Promise<string[]> => {
  const configuredQueues = getConfiguredQueueNames();
  const persistedQueues = await redis.smembers(KNOWN_QUEUES_SET_KEY);

  return Array.from(new Set([...configuredQueues, ...persistedQueues])).sort();
};

export const retryFailedJobs = async (
  options: RetryFailedJobsOptions,
  logger: Logger,
): Promise<RetryFailedJobsResult> => {
  const queue = new Queue(options.queueName, { connection: getRedisConnection() });
  const resourceId = options.jobId ?? options.queueName;

  try {
    const jobs = options.jobId
      ? [await queue.getJob(options.jobId)].filter((job): job is NonNullable<typeof job> =>
          Boolean(job),
        )
      : await queue.getFailed(0, Math.max(options.limit - 1, 0));

    const failedJobs = options.jobId ? jobs.filter((job) => job.failedReason !== undefined) : jobs;

    logger.info('Loaded failed jobs for retry', {
      queueName: options.queueName,
      requestedLimit: options.limit,
      targetedJobs: failedJobs.length,
      dryRun: Boolean(options.dryRun),
      jobId: options.jobId,
    });

    if (options.dryRun) {
      const dryRunResult: RetryFailedJobsResult = {
        queueName: options.queueName,
        targetedJobs: failedJobs.length,
        retriedJobs: 0,
        failedRetries: [],
        dryRun: true,
      };

      await auditLogger({
        actorId: options.actor,
        action: 'admin:job:retry',
        resourceType: 'job',
        resourceId,
        outcome: 'success',
        metadata: {
          queueName: options.queueName,
          jobId: options.jobId,
          targetedJobs: dryRunResult.targetedJobs,
          retriedJobs: dryRunResult.retriedJobs,
          failedRetries: dryRunResult.failedRetries.length,
          dryRun: true,
        },
      });

      return dryRunResult;
    }

    let retriedJobs = 0;
    const failedRetries: Array<{ jobId: string; reason: string }> = [];

    for (const job of failedJobs) {
      try {
        await job.retry();
        retriedJobs += 1;
      } catch (error) {
        failedRetries.push({
          jobId: String(job.id),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Failed job retry completed', {
      queueName: options.queueName,
      targetedJobs: failedJobs.length,
      retriedJobs,
      failedRetries: failedRetries.length,
    });

    const result: RetryFailedJobsResult = {
      queueName: options.queueName,
      targetedJobs: failedJobs.length,
      retriedJobs,
      failedRetries,
      dryRun: false,
    };

    await auditLogger({
      actorId: options.actor,
      action: 'admin:job:retry',
      resourceType: 'job',
      resourceId,
      outcome: 'success',
      metadata: {
        queueName: options.queueName,
        jobId: options.jobId,
        targetedJobs: result.targetedJobs,
        retriedJobs: result.retriedJobs,
        failedRetries: result.failedRetries.length,
        dryRun: false,
      },
    });

    return result;
  } catch (error) {
    await auditLogger({
      actorId: options.actor,
      action: 'admin:job:retry',
      resourceType: 'job',
      resourceId,
      outcome: 'failure',
      metadata: {
        queueName: options.queueName,
        jobId: options.jobId,
        dryRun: Boolean(options.dryRun),
        error: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  } finally {
    await queue.close();
  }
};
