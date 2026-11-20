import { Logger } from '../lib/logger';
import { getDiscoveredQueueNames, retryFailedJobs } from '../admin/jobAdminService';
import { getConfiguredQueueNames } from '../config/runtime';
import { Queue } from 'bullmq';

jest.mock('../config/runtime', () => ({
  getConfiguredQueueNames: jest.fn(),
  getRedisConnection: jest.fn(),
}));

const mockSmembers = jest.fn();

jest.mock('../lib/redis', () => ({
  redis: { smembers: (...args: unknown[]) => mockSmembers(...args) },
}));

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
}));

const mockAuditLog = jest.fn();

jest.mock('../lib/auditLogger', () => ({
  auditLogger: {
    log: (...args: unknown[]) => mockAuditLog(...args),
  },
}));

describe('jobAdminService', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  const mockedGetConfiguredQueueNames = getConfiguredQueueNames as jest.MockedFunction<typeof getConfiguredQueueNames>;
  const QueueMock = Queue as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should combine configured and persisted queue names into a unique sorted list', async () => {
    mockedGetConfiguredQueueNames.mockReturnValue(['queue-b', 'queue-a']);
    mockSmembers.mockImplementation(jest.fn().mockResolvedValue(['queue-c', 'queue-b']));

    const queues = await getDiscoveredQueueNames();

    expect(queues).toEqual(['queue-a', 'queue-b', 'queue-c']);
  });

  it('should retry a targeted failed job by ID', async () => {
    const retryMock = jest.fn().mockResolvedValue(undefined);
    const getJobMock = jest.fn().mockResolvedValue({ failedReason: 'failed', retry: retryMock, id: 'job-1' });
    const closeMock = jest.fn().mockResolvedValue(undefined);
    QueueMock.mockImplementation(() => ({
      getJob: getJobMock,
      close: closeMock,
    }));

    const result = await retryFailedJobs(
      { queueName: 'test-queue', limit: 1, dryRun: false, jobId: 'job-1' },
      mockLogger,
    );

    expect(getJobMock).toHaveBeenCalledWith('job-1');
    expect(retryMock).toHaveBeenCalled();
    expect(result.targetedJobs).toBe(1);
    expect(result.retriedJobs).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(closeMock).toHaveBeenCalled();
  });

  it('should write an audit log entry when an admin retries a job', async () => {
    const retryMock = jest.fn().mockResolvedValue(undefined);
    const getJobMock = jest.fn().mockResolvedValue({ failedReason: 'failed', retry: retryMock, id: 'job-1' });
    const closeMock = jest.fn().mockResolvedValue(undefined);
    QueueMock.mockImplementation(() => ({
      getJob: getJobMock,
      close: closeMock,
    }));

    await retryFailedJobs(
      { queueName: 'test-queue', limit: 1, dryRun: false, jobId: 'job-1', actor: 'admin-user' },
      mockLogger,
    );

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'admin-user',
        jobId: 'job-1',
        action: 'job.retry',
      }),
    );
  });

  it('should return dry-run results without retrying jobs', async () => {
    const failedJobs = [
      { id: 'job-1', failedReason: 'failed', retry: jest.fn() },
      { id: 'job-2', failedReason: 'failed', retry: jest.fn() },
    ];
    const getFailedMock = jest.fn().mockResolvedValue(failedJobs);
    const closeMock = jest.fn().mockResolvedValue(undefined);
    QueueMock.mockImplementation(() => ({
      getFailed: getFailedMock,
      close: closeMock,
    }));

    const result = await retryFailedJobs(
      { queueName: 'test-queue', limit: 10, dryRun: true },
      mockLogger,
    );

    expect(getFailedMock).toHaveBeenCalledWith(0, 9);
    expect(result.dryRun).toBe(true);
    expect(result.retriedJobs).toBe(0);
    expect(result.targetedJobs).toBe(2);
    expect(failedJobs[0].retry).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });
});
