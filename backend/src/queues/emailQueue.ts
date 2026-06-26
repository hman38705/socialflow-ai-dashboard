import { createHash } from 'crypto';
import { queueManager } from './queueManager';

// Queue names
export const EMAIL_QUEUE_NAME = 'email';

// Email job data interfaces
export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: string;
    contentType?: string;
  }>;
  metadata?: {
    userId?: string;
    templateId?: string;
    campaignId?: string;
  };
}

export interface BulkEmailJobData {
  emails: EmailJobData[];
  campaignId?: string;
}

// Create the email queue with optimized settings
export const emailQueue = queueManager.createQueue(EMAIL_QUEUE_NAME, {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
});

// 5-minute deduplication window: same recipient + template within the same bucket maps to the same job ID
function transactionalJobId(to: string, templateId: string): string {
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  return createHash('sha256').update(`${to}:${templateId}:${bucket}`).digest('hex');
}

/**
 * Send a single email by adding to the queue
 */
export async function sendEmail(data: EmailJobData): Promise<string | undefined> {
  const templateId = data.metadata?.templateId ?? 'default';
  const jobId = await queueManager.addJob(EMAIL_QUEUE_NAME, 'send-email', data, {
    priority: 1,
    jobId: transactionalJobId(data.to, templateId),
  });
  return jobId;
}

/**
 * Send bulk emails by adding multiple jobs to the queue
 */
export async function sendBulkEmails(emails: EmailJobData[]): Promise<string[]> {
  const jobs = emails.map((email) => ({
    name: 'send-email',
    data: email,
    options: { priority: 2 }, // Lower priority for bulk emails
  }));

  return await queueManager.addBulkJobs(EMAIL_QUEUE_NAME, jobs);
}

/**
 * Send scheduled email
 */
export async function scheduleEmail(
  data: EmailJobData,
  scheduledFor: Date,
): Promise<string | undefined> {
  const delay = scheduledFor.getTime() - Date.now();

  if (delay < 0) {
    throw new Error('Scheduled time must be in the future');
  }

  const jobId = await queueManager.addJob(EMAIL_QUEUE_NAME, 'send-email', data, {
    priority: 1,
    delay,
  });
  return jobId;
}

/**
 * Send email with retry configuration
 */
export async function sendEmailWithRetry(
  data: EmailJobData,
  options: { maxAttempts?: number; delay?: number } = {},
): Promise<string | undefined> {
  // Create queue with custom settings for this email
  const customQueue = queueManager.createQueue(`${EMAIL_QUEUE_NAME}-retry-${Date.now()}`, {
    attempts: options.maxAttempts || 3,
    backoff: {
      type: 'exponential',
      delay: options.delay || 2000,
    },
  });

  const jobId = await queueManager.addJob(customQueue.name, 'send-email', data, {
    priority: 1,
  });

  return jobId;
}

/**
 * Send templated email
 */
export async function sendTemplatedEmail(
  to: string,
  templateId: string,
  variables: Record<string, any>,
  metadata?: EmailJobData['metadata'],
): Promise<string | undefined> {
  const data: EmailJobData = {
    to,
    subject: '', // Will be filled by template
    body: '', // Will be filled by template
    metadata: {
      templateId,
      ...metadata,
    },
  };

  // Add template variables as part of the data
  const templateData = {
    ...data,
    templateId,
    variables,
  };

  const jobId = await queueManager.addJob(EMAIL_QUEUE_NAME, 'send-email', templateData, {
    priority: 1,
    jobId: transactionalJobId(to, templateId),
  });
  return jobId;
}

/**
 * Get email queue statistics
 */
export async function getEmailQueueStats() {
  return await queueManager.getQueueStats(EMAIL_QUEUE_NAME);
}

/**
 * Get failed email jobs
 */
export async function getFailedEmails(start: number = 0, end: number = 20) {
  return await queueManager.getFailedJobs(EMAIL_QUEUE_NAME, start, end);
}

/**
 * Get waiting email jobs
 */
export async function getWaitingEmails(start: number = 0, end: number = 20) {
  return await queueManager.getWaitingJobs(EMAIL_QUEUE_NAME, start, end);
}

/**
 * Retry a failed email job
 */
export async function retryFailedEmail(jobId: string) {
  return await queueManager.retryJob(EMAIL_QUEUE_NAME, jobId);
}
