import { Job } from 'bullmq';
import { queueManager } from '../queues/queueManager';
import { PayoutJobData, PAYOUT_QUEUE_NAME } from '../queues/payoutQueue';
import { prisma } from '../lib/prisma';
import { createHash } from 'crypto';
import { LockService } from '../utils/LockService';
import { createLogger } from '../lib/logger';
import {
  payoutJobAttemptedTotal,
  payoutJobSucceededTotal,
  payoutJobFailedTotal,
  payoutJobDurationSeconds,
} from '../lib/metrics';

const logger = createLogger('payout-job');

/**
 * Derive a deterministic transaction hash for a payout.
 * In production this would be the actual Stellar transaction hash
 * returned by the Horizon API after building and submitting the tx.
 * By computing it deterministically before submission we can detect
 * duplicate retries and avoid paying a user twice.
 */
function deriveTransactionHash(data: {
  groupId: string;
  amount: number;
  recipient: string;
  currency: string;
  jobId: string;
}): string {
  const payload = `${data.jobId}|${data.groupId}|${data.recipient}|${data.amount}|${data.currency}`;
  return `stellar-tx-${createHash('sha256').update(payload).digest('hex')}`;
}

/**
 * Execute a single payout with validation, locking, idempotency and
 * failure persistence. Shared by the single-payout and batch processors so
 * both paths get identical duplicate-payment protection.
 *
 * Idempotency for Stellar/crypto transactions:
 * Before submitting a Stellar transaction the hash is stored in the
 * PayoutTransaction table. On retry the job checks whether the hash
 * already exists and skips submission, preventing duplicate payouts.
 *
 * @param idempotencyKey Scopes the transaction hash and lock. For single
 *   payouts this is the BullMQ job id; for batches it is the batch job id,
 *   so identical entries within a batch (or a retried batch) collide.
 */
async function executePayout(
  data: PayoutJobData,
  idempotencyKey: string,
  updateProgress: (progress: number) => Promise<unknown>,
) {
  const {
    groupId,
    amount,
    recipient,
    recipientType,
    currency,
    description: _description,
    metadata,
  } = data;

  logger.info(`Processing payout ${idempotencyKey}`, {
    jobId: idempotencyKey,
    groupId,
    amount,
    currency,
    recipient,
  });

  payoutJobAttemptedTotal.inc();
  const endTimer = payoutJobDurationSeconds.startTimer();

  try {
    // Log job progress
    await updateProgress(10);

    // Validate payout data
    if (
      !groupId ||
      amount === undefined ||
      amount === null ||
      !recipient ||
      !recipientType ||
      !currency
    ) {
      throw new Error('Missing required payout fields');
    }

    if (amount <= 0) {
      throw new Error('Payout amount must be greater than 0');
    }

    await updateProgress(20);

    // ── Row-level lock ─────────────────────────────────────────────────────
    // Acquire an exclusive distributed lock keyed to the payout group/job so
    // that concurrent triggers (e.g. manual retry + scheduled run) cannot
    // both read a pending record and initiate duplicate transfers.
    const result = await LockService.withLock(`payout:${groupId}:${idempotencyKey}`, async () => {
      // ── Stellar / crypto idempotency check ──────────────────────────────
      let transactionHash: string | undefined;
      let skipped = false;

      if (recipientType === 'crypto' || recipientType === 'wallet') {
        transactionHash = deriveTransactionHash({
          groupId,
          amount,
          recipient,
          currency,
          jobId: idempotencyKey,
        });

        const existing = await prisma.payoutTransaction.findUnique({
          where: { transactionHash },
        });

        if (existing) {
          logger.info(`Duplicate detected for payout ${idempotencyKey} — skipping submission`, {
            jobId: idempotencyKey,
            existingTransactionId: existing.id,
          });
          skipped = true;
        } else {
          await prisma.payoutTransaction.create({
            data: {
              groupId,
              recipient,
              amount,
              currency,
              transactionHash,
              jobId: idempotencyKey,
              status: 'pending',
            },
          });
        }
      }

      // ── Payment processing ───────────────────────────────────────────────
      if (!skipped) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await updateProgress(80);

        if (recipientType === 'crypto' || recipientType === 'wallet') {
          await new Promise((resolve) => setTimeout(resolve, 200));

          if (transactionHash) {
            await prisma.payoutTransaction.update({
              where: { transactionHash },
              data: { status: 'confirmed', confirmedAt: new Date() },
            });
          }
        }
      }

      await updateProgress(95);

      logger.info(`Payout ${idempotencyKey} completed successfully`, {
        jobId: idempotencyKey,
        amount,
        currency,
        recipient,
        skipped,
      });

      return {
        success: true,
        transactionId: idempotencyKey,
        transactionHash,
        groupId,
        amount,
        currency,
        recipient,
        recipientType,
        status: 'completed',
        skipped,
        processedAt: new Date().toISOString(),
        metadata,
      };
    });

    payoutJobSucceededTotal.inc();
    endTimer();

    return result;
  } catch (error: any) {
    const reason = error.message as string;
    logger.error(`Payout ${idempotencyKey} failed`, { jobId: idempotencyKey, reason });

    payoutJobFailedTotal.inc();
    endTimer();

    try {
      await prisma.payoutFailure.create({
        data: {
          jobId: idempotencyKey,
          groupId: groupId ?? 'unknown',
          recipient: recipient ?? 'unknown',
          amount: amount ?? 0,
          currency: currency ?? 'unknown',
          reason,
        },
      });
    } catch (dbErr: any) {
      logger.error('Failed to persist payout failure record', {
        jobId: idempotencyKey,
        error: dbErr.message,
      });
    }

    throw new Error(`Failed to process payout: ${reason}`);
  }
}

/**
 * Payout job processor
 * Handles processing payouts with retry logic and error handling
 */
export async function processPayoutJob(job: Job<PayoutJobData>) {
  return executePayout(job.data, job.id ?? 'unknown', (progress) =>
    job.updateProgress(progress),
  );
}

/**
 * Create payout worker using the queue manager
 */
export function createPayoutWorker() {
  return queueManager.createWorker('payout', processPayoutJob, {
    concurrency: 3, // Lower concurrency for financial transactions
  });
}

/**
 * Process batch payout job.
 *
 * Each entry goes through the same validated, locked and idempotent path as
 * a single payout (executePayout), keyed on the batch job id. Duplicate
 * entries in the same batch — or entries already paid by an earlier attempt
 * of this batch job — are detected and skipped rather than paid again.
 */
export async function processBatchPayoutJob(job: Job<{ payouts: PayoutJobData[] }>) {
  const { payouts } = job.data;
  const batchKey = job.id ?? 'unknown';

  logger.info(`Processing batch job ${job.id}`, { jobId: job.id, payoutCount: payouts.length });

  const results: Array<{
    success: boolean;
    skipped?: boolean;
    transactionId?: string;
    transactionHash?: string;
    recipient?: string;
    error?: string;
  }> = [];

  let totalAmount = 0;
  let successfulAmount = 0;

  for (let i = 0; i < payouts.length; i++) {
    const payout = payouts[i];

    try {
      if (typeof payout.amount === 'number') {
        totalAmount += payout.amount;
      }

      const result = await executePayout(payout, batchKey, async () => undefined);

      if (!result.skipped) {
        successfulAmount += payout.amount;
      }

      results.push({
        success: true,
        skipped: result.skipped,
        transactionId: `${batchKey}-${i}`,
        transactionHash: result.transactionHash,
        recipient: payout.recipient,
      });
    } catch (error: any) {
      results.push({
        success: false,
        recipient: payout.recipient,
        error: error.message,
      });
    }

    await job.updateProgress(Math.floor(((i + 1) / payouts.length) * 100));
  }

  const successful = results.filter((r) => r.success).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;

  logger.info(`Batch job ${job.id} completed`, {
    jobId: job.id,
    successful,
    skipped,
    successfulAmount,
    failed,
  });

  // Re-enqueue failed items individually so each gets its own retry budget
  if (failed > 0) {
    const failedPayouts = payouts.filter((_, i) => !results[i].success);
    const reEnqueueJobs = failedPayouts.map((payout) => ({
      name: 'process-payout',
      data: payout,
      options: { priority: 1 },
    }));
    await queueManager.addBulkJobs(PAYOUT_QUEUE_NAME, reEnqueueJobs);

    throw new Error(
      `Batch job ${job.id} had ${failed}/${payouts.length} failed payouts; re-enqueued for retry`,
    );
  }

  return {
    success: true,
    jobId: job.id,
    totalPayouts: payouts.length,
    successfulPayouts: successful,
    skippedPayouts: skipped,
    failedPayouts: failed,
    totalAmount,
    successfulAmount,
    results,
    completedAt: new Date().toISOString(),
  };
}
