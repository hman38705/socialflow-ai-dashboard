import { UnrecoverableError } from 'bullmq';
import { processEmailJob, emailDroppedTotal } from '../jobs/emailJob';
import { EmailJobData } from '../queues/emailQueue';

function makeJob(data: Partial<EmailJobData> = {}): any {
  return {
    id: 'job-1',
    data: { to: 'user@example.com', subject: 'Hi', body: 'Hello', ...data },
    updateProgress: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

describe('processEmailJob', () => {
  beforeEach(() => {
    emailDroppedTotal.reset();
  });

  it('completes successfully for valid email data', async () => {
    const job = makeJob();
    const result = await processEmailJob(job);
    expect(result.success).toBe(true);
    expect(result.recipient).toBe('user@example.com');
  });

  it('rethrows a retryable error without dropping the email', async () => {
    const job = makeJob({ to: '' });
    await expect(processEmailJob(job)).rejects.toThrow('Failed to send email');
    expect(job.update).not.toHaveBeenCalled();
  });

  it('drops the email and records the SES error code for a non-retryable SES error', async () => {
    const job = makeJob();
    const sesError: any = new Error('MessageRejected: address on suppression list');
    sesError.name = 'MessageRejected';

    // The "send" step is simulated in emailJob.ts; throwing from updateProgress
    // exercises the same catch block a real SES rejection would hit.
    (job.updateProgress as jest.Mock).mockImplementation(() => {
      throw sesError;
    });

    await expect(processEmailJob(job)).rejects.toThrow(UnrecoverableError);
    expect(job.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', sesErrorCode: 'MessageRejected' }),
    );

    const metric = emailDroppedTotal.get();
    const sample = metric.values.find((v: { labels: { code?: string } }) => v.labels.code === 'MessageRejected');
    expect(sample?.value).toBe(1);
  });
});
