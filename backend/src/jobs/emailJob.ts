import { Job, UnrecoverableError } from 'bullmq';
import { Counter } from 'prom-client';
import { queueManager } from '../queues/queueManager';
import { EmailJobData } from '../queues/emailQueue';
import { register } from '../lib/metrics';
import { createLogger } from '../lib/logger';

const logger = createLogger('email-job');

/**
 * SES error codes that will never succeed on retry (bad recipient, malformed
 * params, etc). These are dropped immediately instead of exhausting retries.
 */
const NON_RETRYABLE_SES_CODES = new Set([
  'MessageRejected',
  'InvalidParameterValue',
  'MailFromDomainNotVerifiedException',
  'ConfigurationSetDoesNotExistException',
  'AccountSendingPausedException',
]);

export const emailDroppedTotal = new Counter({
  name: 'email_dropped_total',
  help: 'Total number of emails dropped due to a non-retryable SES error',
  labelNames: ['code'] as const,
  registers: [register],
});

/** Alert once the number of drops in the current process reaches this many. */
const DROPPED_RATE_ALERT_THRESHOLD = Number(process.env.EMAIL_DROPPED_RATE_ALERT_THRESHOLD ?? 10);
let droppedSinceLastAlert = 0;

function getSesErrorCode(error: any): string | undefined {
  return error?.Code || error?.code || error?.name;
}

function isNonRetryableSesError(error: any): boolean {
  const code = getSesErrorCode(error);
  return !!code && NON_RETRYABLE_SES_CODES.has(code);
}

async function dropEmail(job: Job<EmailJobData>, error: any): Promise<void> {
  const code = getSesErrorCode(error) ?? 'Unknown';
  emailDroppedTotal.inc({ code });
  await job.updateData({ ...job.data, status: 'failed', sesErrorCode: code });
  logger.error(`Email dropped — non-retryable SES error`, { jobId: job.id, code });

  droppedSinceLastAlert++;
  if (droppedSinceLastAlert >= DROPPED_RATE_ALERT_THRESHOLD) {
    logger.error('ALERT: dropped-email rate threshold exceeded', {
      droppedSinceLastAlert,
      threshold: DROPPED_RATE_ALERT_THRESHOLD,
    });
    droppedSinceLastAlert = 0;
  }
}

/**
 * Email job processor
 * Handles sending emails with retry logic and error handling
 */
export async function processEmailJob(job: Job<EmailJobData>) {
  const { to, subject, body, html: _html, attachments: _attachments, metadata } = job.data;

  console.log(`[EmailJob] Processing job ${job.id} - sending to ${to}`);

  try {
    // Log job progress
    await job.updateProgress(10);

    // Validate email data
    if (!to || !subject || !body) {
      throw new Error('Missing required email fields: to, subject, or body');
    }

    // Log progress
    await job.updateProgress(20);

    // Simulate email sending - replace with actual email service implementation
    // const emailService = require('../services/emailService').emailService;
    // const result = await emailService.send({
    //   to,
    //   subject,
    //   body,
    //   html,
    //   attachments,
    // });

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 100));

    await job.updateProgress(90);

    // Log completion
    console.log(`[EmailJob] Job ${job.id} completed successfully`);

    return {
      success: true,
      emailId: job.id,
      recipient: to,
      subject,
      sentAt: new Date().toISOString(),
      metadata,
    };
  } catch (error: any) {
    if (isNonRetryableSesError(error)) {
      await dropEmail(job, error);
      throw new UnrecoverableError(`Email dropped: ${getSesErrorCode(error)}`);
    }
    console.error(`[EmailJob] Job ${job.id} failed:`, error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Create email worker using the queue manager
 */
export function createEmailWorker() {
  return queueManager.createWorker('email', processEmailJob, {
    concurrency: 10,
  });
}

/**
 * Process bulk email job
 */
export async function processBulkEmailJob(job: Job<{ emails: EmailJobData[] }>) {
  const { emails } = job.data;

  console.log(`[BulkEmailJob] Processing job ${job.id} - ${emails.length} emails`);

  const results: Array<{
    success: boolean;
    emailId?: string;
    recipient?: string;
    error?: string;
  }> = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    try {
      // Simulate sending each email
      await new Promise((resolve) => setTimeout(resolve, 50));

      results.push({
        success: true,
        emailId: `${job.id}-${i}`,
        recipient: email.to,
      });

      await job.updateProgress(Math.floor(((i + 1) / emails.length) * 100));
    } catch (error: any) {
      results.push({
        success: false,
        recipient: email.to,
        error: error.message,
      });
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`[BulkEmailJob] Job ${job.id} completed: ${successful} sent, ${failed} failed`);

  return {
    success: true,
    jobId: job.id,
    total: emails.length,
    successful,
    failed,
    results,
    completedAt: new Date().toISOString(),
  };
}
