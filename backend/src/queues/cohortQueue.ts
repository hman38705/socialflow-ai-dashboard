import { queueManager } from './queueManager';

export const COHORT_QUEUE_NAME = 'cohort';

export interface CohortJobData {
  organizationId?: string; // omit for global recompute
  triggeredBy?: 'daily' | 'weekly' | 'manual';
  /**
   * Set internally by the weekly job when it starts waiting for the daily
   * job on Monday; preserved across delayed re-runs to bound the total wait.
   */
  waitStartedAt?: string;
}

export const cohortQueue = queueManager.createQueue(COHORT_QUEUE_NAME, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
});

/** Enqueue a one-off cohort recompute */
export async function enqueueCohortCompute(data: CohortJobData = {}): Promise<string | undefined> {
  return queueManager.addJob(COHORT_QUEUE_NAME, 'compute-cohorts', data);
}

/** Schedule daily cohort recompute (runs at midnight UTC) */
export async function scheduleDailyCohortJob(): Promise<string | undefined> {
  return queueManager.addJob(
    COHORT_QUEUE_NAME,
    'compute-cohorts',
    { triggeredBy: 'daily' } satisfies CohortJobData,
    { repeat: { pattern: '0 0 * * *' } },
  );
}

/** Schedule weekly cohort recompute (runs every Monday at 1 AM UTC) */
export async function scheduleWeeklyCohortJob(): Promise<string | undefined> {
  return queueManager.addJob(
    COHORT_QUEUE_NAME,
    'compute-cohorts',
    { triggeredBy: 'weekly' } satisfies CohortJobData,
    { repeat: { pattern: '0 1 * * 1' } },
  );
}

export async function getCohortQueueStats() {
  return queueManager.getQueueStats(COHORT_QUEUE_NAME);
}
