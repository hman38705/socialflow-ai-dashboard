import { Logger } from '../lib/logger';
import { getDiscoveredQueueNames, retryFailedJobs } from '../admin/jobAdminService';
import { getConfiguredQueueNames } from '../config/runtime';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

jest.mock('../config/runtime', () => ({
  getConfiguredQueueNames: jest.fn(),
  getRedisConnection: jest.fn(),
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    smembers: jest.fn(),
    disconnect: jest.fn(),
  }));
});

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
}));

describe('jobAdminService', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  const mockedGetConfiguredQueueNames = getConfiguredQueueNames as jest.MockedFunction<typeof getConfiguredQueueNames>;
  const RedisMock = Redis as unknown as jest.Mock;
  const QueueMock = Queue as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should combine configured and persisted queue names into a unique sorted list', async () => {
    mockedGetConfiguredQueueNames.mockReturnValue(['queue-b', 'queue-a']);
    RedisMock.mockImplementation(() => ({
      smembers: jest.fn().mockResolvedValue(['queue-c', 'queue-b']),
      disconnect: jest.fn(),
    }));

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
