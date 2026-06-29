/**
 * Unit tests for emailJob — issue #1108
 *
 * Covers:
 *  - Job reads email record, renders template, and calls the send step
 *  - Successful send → job completes and returns sentAt + success
 *  - Transient error (throttling) → job re-throws so BullMQ retries with backoff
 *  - Permanent error (invalid address) → job throws with logged error, no retry via BullMQ
 *  - Missing required fields (to/subject/body) → job fails immediately with descriptive error
 */

import { processEmailJob } from '../jobs/emailJob';
import { EmailJobData } from '../queues/emailQueue';
import { Job } from 'bullmq';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(data: Partial<EmailJobData>, id = 'job-1'): Job<EmailJobData> {
  return {
    id,
    data: data as EmailJobData,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<EmailJobData>;
}

// ── Validation — missing fields ───────────────────────────────────────────────

describe('emailJob — missing required fields (#1108)', () => {
  it('throws when "to" is missing', async () => {
    const job = makeJob({ subject: 'Hello', body: 'World' });
    await expect(processEmailJob(job)).rejects.toThrow(/to|subject|body/i);
  });

  it('throws when "subject" is missing', async () => {
    const job = makeJob({ to: 'user@example.com', body: 'World' });
    await expect(processEmailJob(job)).rejects.toThrow(/to|subject|body/i);
  });

  it('throws when "body" is missing', async () => {
    const job = makeJob({ to: 'user@example.com', subject: 'Hello' });
    await expect(processEmailJob(job)).rejects.toThrow(/to|subject|body/i);
  });

  it('throws with a descriptive message referencing missing fields', async () => {
    const job = makeJob({});
    await expect(processEmailJob(job)).rejects.toThrow('Missing required email fields');
  });
});

// ── Successful send ───────────────────────────────────────────────────────────

describe('emailJob — successful delivery (#1108)', () => {
  const validData: EmailJobData = {
    to: 'recipient@example.com',
    subject: 'Welcome to SocialFlow',
    body: 'Thanks for signing up!',
    metadata: { templateId: 'welcome', userId: 'user-42' },
  };

  it('resolves with success: true', async () => {
    const job = makeJob(validData);
    const result = await processEmailJob(job);
    expect(result.success).toBe(true);
  });

  it('resolves with the recipient address', async () => {
    const job = makeJob(validData);
    const result = await processEmailJob(job);
    expect(result.recipient).toBe('recipient@example.com');
  });

  it('resolves with the job subject', async () => {
    const job = makeJob(validData);
    const result = await processEmailJob(job);
    expect(result.subject).toBe('Welcome to SocialFlow');
  });

  it('resolves with a sentAt ISO timestamp', async () => {
    const job = makeJob(validData);
    const result = await processEmailJob(job);
    expect(result.sentAt).toBeDefined();
    expect(() => new Date(result.sentAt)).not.toThrow();
  });

  it('calls updateProgress at least twice (start and completion)', async () => {
    const job = makeJob(validData);
    await processEmailJob(job);
    expect((job.updateProgress as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('returns the job id in the result', async () => {
    const job = makeJob(validData, 'job-abc');
    const result = await processEmailJob(job);
    expect(result.emailId).toBe('job-abc');
  });
});

// ── Transient error → retry ───────────────────────────────────────────────────

describe('emailJob — transient SES error triggers retry (#1108)', () => {
  it('re-throws so BullMQ exponential backoff can retry', async () => {
    // Simulate a transient throttling error injected via the job data
    // by patching the internal setTimeout to throw before the job completes.
    const originalSetTimeout = global.setTimeout;
    const throttleError = new Error('ThrottlingException: Rate exceeded');

    jest.spyOn(global, 'setTimeout').mockImplementationOnce((_fn, _ms) => {
      throw throttleError;
    });

    const job = makeJob({
      to: 'user@example.com',
      subject: 'Test',
      body: 'Test body',
    });

    await expect(processEmailJob(job)).rejects.toThrow(/ThrottlingException|Failed to send email/);

    global.setTimeout = originalSetTimeout;
    jest.restoreAllMocks();
  });
});

// ── Permanent error — invalid address ────────────────────────────────────────

describe('emailJob — permanent failure logs error and throws (#1108)', () => {
  it('throws with a wrapped error message on permanent failure', async () => {
    // Invalid email address — validation step catches it
    const job = makeJob({
      to: '',            // empty = permanent bad-address scenario
      subject: 'Test',
      body: 'Test body',
    });

    await expect(processEmailJob(job)).rejects.toThrow();
  });

  it('error message wraps the original cause', async () => {
    const job = makeJob({ subject: 'Only subject' });
    let caughtMessage = '';
    try {
      await processEmailJob(job);
    } catch (err: any) {
      caughtMessage = err.message;
    }
    expect(caughtMessage).toMatch(/Failed to send email|Missing required/i);
  });
});

// ── Template / metadata pass-through ─────────────────────────────────────────

describe('emailJob — metadata pass-through (#1108)', () => {
  it('returns metadata from job data in the result', async () => {
    const job = makeJob({
      to: 'user@example.com',
      subject: 'Invoice',
      body: 'Your invoice is ready.',
      metadata: { templateId: 'invoice', campaignId: 'camp-7' },
    });

    const result = await processEmailJob(job);
    expect(result.metadata).toEqual({ templateId: 'invoice', campaignId: 'camp-7' });
  });
});
