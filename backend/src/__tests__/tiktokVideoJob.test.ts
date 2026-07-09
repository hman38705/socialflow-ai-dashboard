/**
 * Unit tests for tiktokVideoJob — chunk size selection, failure recovery, and progress cleanup.
 *
 * Closes #1060
 */

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => ({
    processor,
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('fs', () => ({
  promises: {
    open: jest.fn(),
  },
}));

jest.mock('../config/runtime', () => ({
  getRedisConnection: jest.fn().mockReturnValue({}),
}));

jest.mock('../services/TikTokService', () => ({
  tiktokService: {
    getUploadSession: jest.fn(),
    getLastUploadedChunk: jest.fn(),
    initiateVideoUpload: jest.fn(),
    storeUploadSession: jest.fn(),
    uploadChunk: jest.fn(),
    clearUploadProgress: jest.fn(),
    clearUploadSession: jest.fn(),
    getVideoStatus: jest.fn(),
  },
}));

jest.mock('../services/WebhookDispatcher', () => ({
  dispatchEvent: jest.fn().mockResolvedValue(undefined),
}));

import { Worker } from 'bullmq';
import fs from 'fs';
import { startTikTokVideoWorker } from '../jobs/tiktokVideoJob';
import { tiktokService } from '../services/TikTokService';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB — matches TikTokService constant

const defaultSession = {
  publishId: 'pub-abc123',
  uploadUrl: 'https://upload.tiktok.com/v2/123',
  chunkSize: CHUNK_SIZE,
  totalChunks: 3,
};

const mockFileHandle = {
  read: jest.fn().mockResolvedValue({ bytesRead: CHUNK_SIZE }),
  close: jest.fn().mockResolvedValue(undefined),
};

function makeVideoJob(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 'tiktok-job-1',
    name: 'upload-tiktok-video',
    data: {
      accessToken: 'tok-access',
      refreshToken: 'tok-refresh',
      expiresAt: Date.now() + 3_600_000,
      filePath: '/tmp/video.mp4',
      fileSizeBytes: 30 * 1024 * 1024, // 30 MB → 3 chunks
      request: {
        title: 'My TikTok',
        sourceType: 'FILE_UPLOAD',
        videoSource: '/tmp/video.mp4',
      },
      ...overrides,
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

function getWorkerProcessor(): (job: any) => Promise<void> {
  const calls = (Worker as unknown as jest.Mock).mock.calls;
  if (!calls.length) throw new Error('Worker constructor was not called');
  return calls[0][1];
}

beforeAll(() => {
  (fs.promises.open as jest.Mock).mockResolvedValue(mockFileHandle);
  startTikTokVideoWorker();
});

beforeEach(() => {
  jest.clearAllMocks();
  (fs.promises.open as jest.Mock).mockResolvedValue(mockFileHandle);
  mockFileHandle.read.mockResolvedValue({ bytesRead: CHUNK_SIZE });
  mockFileHandle.close.mockResolvedValue(undefined);

  (tiktokService.getUploadSession as jest.Mock).mockResolvedValue(null);
  (tiktokService.initiateVideoUpload as jest.Mock).mockResolvedValue({ ...defaultSession });
  (tiktokService.storeUploadSession as jest.Mock).mockResolvedValue(undefined);
  (tiktokService.uploadChunk as jest.Mock).mockResolvedValue(undefined);
  (tiktokService.clearUploadProgress as jest.Mock).mockResolvedValue(undefined);
  (tiktokService.clearUploadSession as jest.Mock).mockResolvedValue(undefined);
  (tiktokService.getLastUploadedChunk as jest.Mock).mockResolvedValue(-1);
});

// ── chunk size selection ──────────────────────────────────────────────────────

describe('tiktokVideoJob — chunk size selection', () => {
  it('uploads exactly totalChunks chunks for the given file', async () => {
    const processor = getWorkerProcessor();
    const job = makeVideoJob({ fileSizeBytes: 30 * 1024 * 1024 }); // 3 chunks

    await processor(job);

    expect(tiktokService.uploadChunk).toHaveBeenCalledTimes(3);
  });

  it('passes fileSizeBytes to initiateVideoUpload so TikTok can compute chunks', async () => {
    const processor = getWorkerProcessor();
    const fileSizeBytes = 25 * 1024 * 1024;
    const job = makeVideoJob({ fileSizeBytes });

    await processor(job);

    expect(tiktokService.initiateVideoUpload).toHaveBeenCalledWith(
      'tok-access',
      fileSizeBytes,
      expect.objectContaining({ title: 'My TikTok' }),
    );
  });

  it('allocates a smaller buffer for the last chunk when file size is not a multiple of chunk size', async () => {
    const processor = getWorkerProcessor();
    const fileSizeBytes = 25 * 1024 * 1024; // 25 MB → 2 full chunks + 5 MB remainder
    const session = { ...defaultSession, totalChunks: 3, chunkSize: CHUNK_SIZE };
    (tiktokService.initiateVideoUpload as jest.Mock).mockResolvedValue(session);

    const capturedBufferSizes: number[] = [];
    mockFileHandle.read.mockImplementation(async (buf: Buffer) => {
      capturedBufferSizes.push(buf.length);
      return { bytesRead: buf.length };
    });

    const job = makeVideoJob({ fileSizeBytes });
    await processor(job);

    expect(capturedBufferSizes[0]).toBe(CHUNK_SIZE);              // chunk 0 — full
    expect(capturedBufferSizes[1]).toBe(CHUNK_SIZE);              // chunk 1 — full
    expect(capturedBufferSizes[2]).toBe(5 * 1024 * 1024);         // chunk 2 — 5 MB tail
  });

  it('reports 100% progress after the final chunk is uploaded', async () => {
    const processor = getWorkerProcessor();
    const job = makeVideoJob();

    await processor(job);

    const progressCalls = (job.updateProgress as jest.Mock).mock.calls;
    const lastProgress = progressCalls[progressCalls.length - 1][0];
    expect(lastProgress).toBe(100);
  });

  it('reports increasing progress values across chunks', async () => {
    const processor = getWorkerProcessor();
    const job = makeVideoJob({ fileSizeBytes: 30 * 1024 * 1024 });

    await processor(job);

    const progressCalls = (job.updateProgress as jest.Mock).mock.calls.map((c) => c[0]);
    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i]).toBeGreaterThan(progressCalls[i - 1]);
    }
  });

  it('uploads a single chunk when the file fits in one chunk', async () => {
    const processor = getWorkerProcessor();
    const fileSizeBytes = 5 * 1024 * 1024; // 5 MB < 10 MB chunk size
    const session = { ...defaultSession, totalChunks: 1 };
    (tiktokService.initiateVideoUpload as jest.Mock).mockResolvedValue(session);

    const job = makeVideoJob({ fileSizeBytes });
    await processor(job);

    expect(tiktokService.uploadChunk).toHaveBeenCalledTimes(1);
    expect(job.updateProgress).toHaveBeenLastCalledWith(100);
  });
});

// ── failure recovery ──────────────────────────────────────────────────────────

describe('tiktokVideoJob — failure recovery', () => {
  it('resumes upload from the chunk after the last successfully uploaded one', async () => {
    const processor = getWorkerProcessor();
    const existingSession = { ...defaultSession, totalChunks: 3 };
    (tiktokService.getUploadSession as jest.Mock).mockResolvedValue(existingSession);
    (tiktokService.getLastUploadedChunk as jest.Mock).mockResolvedValue(1); // chunks 0 & 1 done

    const job = makeVideoJob();
    await processor(job);

    // Only chunk 2 should be uploaded
    expect(tiktokService.uploadChunk).toHaveBeenCalledTimes(1);
    const [, , uploadedChunkIndex] = (tiktokService.uploadChunk as jest.Mock).mock.calls[0];
    expect(uploadedChunkIndex).toBe(2);
  });

  it('starts from chunk 0 when the last uploaded chunk is -1 (none confirmed)', async () => {
    const processor = getWorkerProcessor();
    const existingSession = { ...defaultSession, totalChunks: 3 };
    (tiktokService.getUploadSession as jest.Mock).mockResolvedValue(existingSession);
    (tiktokService.getLastUploadedChunk as jest.Mock).mockResolvedValue(-1);

    const job = makeVideoJob();
    await processor(job);

    expect(tiktokService.uploadChunk).toHaveBeenCalledTimes(3);
    const firstChunkIndex = (tiktokService.uploadChunk as jest.Mock).mock.calls[0][2];
    expect(firstChunkIndex).toBe(0);
  });

  it('does not call initiateVideoUpload when an existing session is found', async () => {
    const processor = getWorkerProcessor();
    (tiktokService.getUploadSession as jest.Mock).mockResolvedValue({ ...defaultSession });
    (tiktokService.getLastUploadedChunk as jest.Mock).mockResolvedValue(-1);

    const job = makeVideoJob();
    await processor(job);

    expect(tiktokService.initiateVideoUpload).not.toHaveBeenCalled();
  });

  it('calls initiateVideoUpload and stores session when no prior session exists', async () => {
    const processor = getWorkerProcessor();
    (tiktokService.getUploadSession as jest.Mock).mockResolvedValue(null);

    const job = makeVideoJob();
    await processor(job);

    expect(tiktokService.initiateVideoUpload).toHaveBeenCalledTimes(1);
    expect(tiktokService.storeUploadSession).toHaveBeenCalledTimes(1);
  });

  it('uses a stable session key derived from the file path', async () => {
    const processor = getWorkerProcessor();
    const filePath = '/data/videos/my-clip.mp4';
    const expectedKey = Buffer.from(filePath).toString('base64').slice(0, 64);

    const job = makeVideoJob({ filePath });
    await processor(job);

    expect(tiktokService.getUploadSession).toHaveBeenCalledWith(expectedKey);
    expect(tiktokService.clearUploadSession).toHaveBeenCalledWith(expectedKey);
  });

  it('resumes from chunk 0 when all previous chunks need re-upload (lastChunk = -1)', async () => {
    const processor = getWorkerProcessor();
    const session = { ...defaultSession, totalChunks: 2 };
    (tiktokService.getUploadSession as jest.Mock).mockResolvedValue(session);
    (tiktokService.getLastUploadedChunk as jest.Mock).mockResolvedValue(-1);

    const job = makeVideoJob({ fileSizeBytes: 20 * 1024 * 1024 });
    await processor(job);

    expect(tiktokService.uploadChunk).toHaveBeenCalledTimes(2);
    const indices = (tiktokService.uploadChunk as jest.Mock).mock.calls.map((c) => c[2]);
    expect(indices).toEqual([0, 1]);
  });
});

// ── progress cleanup ──────────────────────────────────────────────────────────

describe('tiktokVideoJob — progress cleanup', () => {
  it('calls clearUploadProgress with the publishId when a chunk upload fails', async () => {
    const processor = getWorkerProcessor();
    (tiktokService.uploadChunk as jest.Mock).mockRejectedValue(new Error('Network timeout'));

    const job = makeVideoJob();
    await expect(processor(job)).rejects.toThrow('Network timeout');

    expect(tiktokService.clearUploadProgress).toHaveBeenCalledWith(defaultSession.publishId);
  });

  it('re-throws the original error after cleaning up progress', async () => {
    const processor = getWorkerProcessor();
    const uploadError = new Error('S3 upload failed');
    (tiktokService.uploadChunk as jest.Mock).mockRejectedValue(uploadError);

    const job = makeVideoJob();
    await expect(processor(job)).rejects.toThrow('S3 upload failed');
  });

  it('clears progress and session on successful upload completion', async () => {
    const processor = getWorkerProcessor();

    const job = makeVideoJob();
    await processor(job);

    expect(tiktokService.clearUploadProgress).toHaveBeenCalledWith(defaultSession.publishId);
    const sessionKey = Buffer.from(job.data.filePath).toString('base64').slice(0, 64);
    expect(tiktokService.clearUploadSession).toHaveBeenCalledWith(sessionKey);
  });

  it('does not clear session when the upload fails mid-way', async () => {
    const processor = getWorkerProcessor();
    (tiktokService.uploadChunk as jest.Mock)
      .mockResolvedValueOnce(undefined) // chunk 0 succeeds
      .mockRejectedValueOnce(new Error('Chunk 1 failed')); // chunk 1 fails

    const job = makeVideoJob();
    await expect(processor(job)).rejects.toThrow();

    expect(tiktokService.clearUploadSession).not.toHaveBeenCalled();
  });

  it('closes the file handle even when an error occurs during upload', async () => {
    const processor = getWorkerProcessor();
    (tiktokService.uploadChunk as jest.Mock).mockRejectedValue(new Error('Upload error'));

    const job = makeVideoJob();
    await expect(processor(job)).rejects.toThrow();

    expect(mockFileHandle.close).toHaveBeenCalledTimes(1);
  });
});
