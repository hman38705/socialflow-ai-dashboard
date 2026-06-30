/**
 * Unit tests for src/utils/queue.ts
 * Closes #1110
 */

jest.mock('../queues/queueManager', () => ({
  queueManager: {
    addJob: jest.fn(),
  },
}));

import { enqueue } from '../utils/queue';
import { queueManager } from '../queues/queueManager';

const mockAddJob = queueManager.addJob as jest.MockedFunction<typeof queueManager.addJob>;

beforeEach(() => {
  mockAddJob.mockReset();
});

describe('enqueue', () => {
  it('calls queueManager.addJob with correct queue, name, and data', async () => {
    mockAddJob.mockResolvedValue('job-1');
    const id = await enqueue('myQueue', 'myJob', { foo: 'bar' });
    expect(mockAddJob).toHaveBeenCalledWith('myQueue', 'myJob', { foo: 'bar' }, expect.any(Object));
    expect(id).toBe('job-1');
  });

  it('forwards priority option to BullMQ job options', async () => {
    mockAddJob.mockResolvedValue('job-2');
    await enqueue('q', 'n', {}, { priority: 3 });
    expect(mockAddJob).toHaveBeenCalledWith('q', 'n', {}, expect.objectContaining({ priority: 3 }));
  });

  it('forwards delay option to BullMQ job options', async () => {
    mockAddJob.mockResolvedValue('job-3');
    await enqueue('q', 'n', {}, { delay: 5000 });
    expect(mockAddJob).toHaveBeenCalledWith('q', 'n', {}, expect.objectContaining({ delay: 5000 }));
  });

  it('sets exponential backoff when attempts is provided', async () => {
    mockAddJob.mockResolvedValue('job-4');
    await enqueue('q', 'n', {}, { attempts: 5 });
    expect(mockAddJob).toHaveBeenCalledWith('q', 'n', {}, expect.objectContaining({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    }));
  });

  it('does not set attempts/backoff when attempts is omitted', async () => {
    mockAddJob.mockResolvedValue('job-5');
    await enqueue('q', 'n', {});
    const opts = mockAddJob.mock.calls[0][3];
    expect(opts).not.toHaveProperty('attempts');
    expect(opts).not.toHaveProperty('backoff');
  });

  it('propagates errors thrown by queueManager.addJob', async () => {
    mockAddJob.mockRejectedValue(new Error('dead-letter'));
    await expect(enqueue('q', 'n', {})).rejects.toThrow('dead-letter');
  });
});
