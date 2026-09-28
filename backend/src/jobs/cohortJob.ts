import { DelayedError, Job } from 'bullmq';
import { cohortService } from '../services/CohortService';
import { createLogger } from '../lib/logger';
import { CohortJobData, COHORT_QUEUE_NAME } from '../queues/cohortQueue';
import { queueManager, redisClient } from '../queues/queueManager';

const logger = createLogger('cohort-job');

export interface WaitOptions {
  pollMs?: number;
  timeoutMs?: number;
}

const DEFAULT_WAIT_TIMEOUT_MS = 55 * 60 * 1_000;

/**
 * Re-check interval when the weekly job is running inside a BullMQ worker.
 * Each check re-enqueues the job as delayed, so this is coarser than the
 * in-process poll interval to avoid churning the queue.
 */
const DEFAULT_DELAYED_POLL_MS = 60_000;

/**
 * TTL for the daily-complete marker. The key is scoped to a single UTC date,
 * so a long TTL cannot be confused with a later day's run; it only needs to
 * outlive any plausible delay before the weekly job checks it (queue backlog,
 * retries, worker restarts, deploys).
 */
export const DAILY_COMPLETE_TTL_SECONDS = 48 * 60 * 60;

/** Key written by the daily job so the weekly job can wait for it on Monday. */
export function dailyCompleteKey(date: Date): string {
  return `cohort:daily-complete:${date.toISOString().slice(0, 10)}`;
}

/** Returns true when the given date falls on a Monday (UTC). */
export function isMonday(date: Date): boolean {
  return date.getUTCDay() === 1;
}

/**
 * Poll Redis until the daily-complete key exists or the timeout elapses.
 * Resolves true if the key appeared, false on timeout.
 */
export async function waitForDailyComplete(
  date: Date,
  { pollMs = 5_000, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS }: WaitOptions = {},
): Promise<boolean> {
  const key = dailyCompleteKey(date);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const exists = await redisClient.exists(key);
    if (exists) return true;
    await new Promise((res) => setTimeout(res, pollMs));
  }
  return false;
}

const WAIT_TIMEOUT_MESSAGE =
  'Weekly cohort job timed out waiting for daily job to complete on Monday';

/**
 * Ensure the daily job has completed before the weekly job proceeds.
 *
 * When running inside a BullMQ worker (a `token` is available), this does not
 * block: if the daily-complete key is missing it moves the job back to the
 * delayed set and throws DelayedError, freeing the worker's concurrency slot
 * until the next check. The start of the wait is persisted in job data so the
 * overall timeout still applies across re-runs.
 *
 * Without a token (direct invocation), it falls back to in-process polling.
 */
async function ensureDailyComplete(
  job: Job<CohortJobData>,
  waitStartedAt: Date,
  now: Date,
  waitOptions: WaitOptions,
  token?: string,
): Promise<void> {
  const timeoutMs = waitOptions.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  if (!token) {
    const dailyDone = await waitForDailyComplete(waitStartedAt, waitOptions);
    if (!dailyDone) throw new Error(WAIT_TIMEOUT_MESSAGE);
    return;
  }

  if (await redisClient.exists(dailyCompleteKey(waitStartedAt))) return;

  if (now.getTime() - waitStartedAt.getTime() >= timeoutMs) {
    throw new Error(WAIT_TIMEOUT_MESSAGE);
  }

  if (!job.data.waitStartedAt) {
    await job.updateData({ ...job.data, waitStartedAt: waitStartedAt.toISOString() });
  }

  const pollMs = waitOptions.pollMs ?? DEFAULT_DELAYED_POLL_MS;
  logger.info('Daily cohort job not complete yet; re-checking later', {
    jobId: job.id,
    retryInMs: pollMs,
  });
  await job.moveToDelayed(Date.now() + pollMs, token);
  throw new DelayedError();
}

/**
 * @param token BullMQ lock token, passed when running inside a worker. Enables
 *   the non-blocking Monday wait (see ensureDailyComplete).
 */
export async function processCohortJob(
  job: Job<CohortJobData>,
  now: Date = new Date(),
  waitOptions: WaitOptions = {},
  token?: string,
): Promise<object> {
  const { organizationId, triggeredBy = 'manual' } = job.data;

  logger.info('Starting cohort computation job', {
    jobId: job.id,
    organizationId,
    triggeredBy,
  });

  // On Monday, the weekly job must wait until the daily job has finished.
  // A delayed re-run keeps the original wait start so it still checks the
  // same day's key even if it resumes after midnight.
  const waitStartedAt = job.data.waitStartedAt ? new Date(job.data.waitStartedAt) : now;
  if (triggeredBy === 'weekly' && isMonday(waitStartedAt)) {
    logger.info('Weekly cohort job waiting for daily job to complete', { jobId: job.id });
    await ensureDailyComplete(job, waitStartedAt, now, waitOptions, token);
    logger.info('Daily cohort job confirmed complete; proceeding with weekly run', { jobId: job.id });
  }

  // Invalidate stale cache before recomputing
  cohortService.invalidateCache(organizationId);

  const result = await cohortService.computeCohorts(organizationId);

  // Signal that the daily job has finished so the weekly job can proceed.
  if (triggeredBy === 'daily') {
    const key = dailyCompleteKey(now);
    // Value records when the daily job actually finished, for diagnostics.
    const completedAt = new Date().toISOString();
    await redisClient.set(key, completedAt, 'EX', DAILY_COMPLETE_TTL_SECONDS);
    logger.info('Daily cohort complete signal written', { key, completedAt });
  }

  const summary = {
    jobId: job.id,
    triggeredBy,
    organizationId: organizationId ?? 'global',
    totalUsers: result.totalUsers,
    segments: result.segments.map((s) => ({
      cohort: s.cohort,
      count: s.count,
    })),
    computedAt: result.computedAt.toISOString(),
  };

  logger.info('Cohort computation job complete', summary);
  return summary;
}

/**
 * Create the cohort worker. BullMQ passes the lock token as the second
 * processor argument, which enables the non-blocking Monday wait.
 */
export function createCohortWorker() {
  return queueManager.createWorker(
    COHORT_QUEUE_NAME,
    (job: Job<CohortJobData>, token?: string) => processCohortJob(job, new Date(), {}, token),
    { concurrency: 2 },
  );
}
