jest.mock('../services/TTSService');

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  createTTSJob,
  getTTSJob,
  listTTSJobs,
  cancelTTSJob,
  listVoices,
} from '../controllers/tts';
import { ttsService } from '../services/TTSService';
import { NotFoundError } from '../lib/errors';
import type { TTSJob } from '../types/tts';

const mockTtsService = ttsService as jest.Mocked<typeof ttsService>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes(): jest.Mocked<Partial<Response>> & { json: jest.Mock; status: jest.Mock } {
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Partial<Response>> & { json: jest.Mock; status: jest.Mock };
  return res;
}

function makeNext(): NextFunction {
  return jest.fn();
}

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    body: {},
    params: {},
    query: {},
    user: { id: 'user-1' },
    ...overrides,
  } as AuthRequest;
}

const sampleJob: TTSJob = {
  id: 'job-abc',
  status: 'pending',
  progress: 0,
  request: { segments: [{ text: 'Hello world' }] },
  segments: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createTTSJob — job submission
// ---------------------------------------------------------------------------
describe('createTTSJob — job submission', () => {
  it('responds 202 with jobId and pending status on success', async () => {
    mockTtsService.createJob.mockResolvedValueOnce('job-abc');
    const req = makeReq({ body: { segments: [{ text: 'Hello' }] } });
    const res = makeRes();
    const next = makeNext();

    await createTTSJob(req as AuthRequest, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job-abc', status: 'pending' });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes userId from req.user to ttsService.createJob', async () => {
    mockTtsService.createJob.mockResolvedValueOnce('job-xyz');
    const req = makeReq({
      body: { segments: [{ text: 'Test' }] },
      user: { id: 'user-99' },
    });
    const res = makeRes();

    await createTTSJob(req as AuthRequest, res as unknown as Response, makeNext());

    expect(mockTtsService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-99', segments: [{ text: 'Test' }] }),
    );
  });

  it('calls next with error when ttsService.createJob rejects', async () => {
    const err = new Error('Quota exceeded');
    mockTtsService.createJob.mockRejectedValueOnce(err);
    const req = makeReq({ body: { segments: [{ text: 'Fail' }] } });
    const res = makeRes();
    const next = makeNext();

    await createTTSJob(req as AuthRequest, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('merges body fields into the job request', async () => {
    mockTtsService.createJob.mockResolvedValueOnce('job-merged');
    const req = makeReq({
      body: {
        segments: [{ text: 'Merge test', voiceId: 'voice-1' }],
        provider: 'elevenlabs',
        videoPath: '/tmp/video.mp4',
      },
    });

    await createTTSJob(req as AuthRequest, makeRes() as unknown as Response, makeNext());

    expect(mockTtsService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'elevenlabs',
        videoPath: '/tmp/video.mp4',
        segments: [{ text: 'Merge test', voiceId: 'voice-1' }],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getTTSJob — status polling
// ---------------------------------------------------------------------------
describe('getTTSJob — status polling', () => {
  it('returns the job when found', async () => {
    mockTtsService.getJob.mockResolvedValueOnce(sampleJob);
    const req = makeReq({ params: { jobId: 'job-abc' } });
    const res = makeRes();
    const next = makeNext();

    await getTTSJob(req as AuthRequest, res as unknown as Response, next);

    expect(mockTtsService.getJob).toHaveBeenCalledWith('job-abc');
    expect(res.json).toHaveBeenCalledWith(sampleJob);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with NotFoundError when job does not exist', async () => {
    mockTtsService.getJob.mockResolvedValueOnce(undefined);
    const req = makeReq({ params: { jobId: 'missing' } });
    const res = makeRes();
    const next = makeNext();

    await getTTSJob(req as AuthRequest, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('forwards the jobId from params to the service', async () => {
    mockTtsService.getJob.mockResolvedValueOnce({ ...sampleJob, id: 'job-999', status: 'processing' });
    const req = makeReq({ params: { jobId: 'job-999' } });

    await getTTSJob(req as AuthRequest, makeRes() as unknown as Response, makeNext());

    expect(mockTtsService.getJob).toHaveBeenCalledWith('job-999');
  });

  it('reflects current job status in the response', async () => {
    const processingJob: TTSJob = { ...sampleJob, status: 'processing', progress: 40 };
    mockTtsService.getJob.mockResolvedValueOnce(processingJob);
    const req = makeReq({ params: { jobId: 'job-abc' } });
    const res = makeRes();

    await getTTSJob(req as AuthRequest, res as unknown as Response, makeNext());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing', progress: 40 }));
  });

  it('calls next with error when ttsService.getJob throws', async () => {
    const err = new Error('DB connection lost');
    mockTtsService.getJob.mockRejectedValueOnce(err);
    const req = makeReq({ params: { jobId: 'job-abc' } });
    const next = makeNext();

    await getTTSJob(req as AuthRequest, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// listTTSJobs — result retrieval (all jobs)
// ---------------------------------------------------------------------------
describe('listTTSJobs — result retrieval', () => {
  it('returns all jobs as JSON', async () => {
    const jobs = [sampleJob, { ...sampleJob, id: 'job-2', status: 'completed' as const }];
    mockTtsService.getAllJobs.mockResolvedValueOnce(jobs);
    const res = makeRes();
    const next = makeNext();

    await listTTSJobs(makeReq() as AuthRequest, res as unknown as Response, next);

    expect(res.json).toHaveBeenCalledWith(jobs);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns an empty array when no jobs exist', async () => {
    mockTtsService.getAllJobs.mockResolvedValueOnce([]);
    const res = makeRes();

    await listTTSJobs(makeReq() as AuthRequest, res as unknown as Response, makeNext());

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('calls next with error when getAllJobs rejects', async () => {
    const err = new Error('Timeout');
    mockTtsService.getAllJobs.mockRejectedValueOnce(err);
    const next = makeNext();

    await listTTSJobs(makeReq() as AuthRequest, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// cancelTTSJob
// ---------------------------------------------------------------------------
describe('cancelTTSJob', () => {
  it('responds with cancellation message when job is found and cancelled', async () => {
    mockTtsService.cancelJob.mockResolvedValueOnce(true);
    const req = makeReq({ params: { jobId: 'job-abc' } });
    const res = makeRes();
    const next = makeNext();

    await cancelTTSJob(req as AuthRequest, res as unknown as Response, next);

    expect(res.json).toHaveBeenCalledWith({ message: 'Job cancelled' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with NotFoundError when job is not found', async () => {
    mockTtsService.cancelJob.mockResolvedValueOnce(false);
    const req = makeReq({ params: { jobId: 'missing' } });
    const next = makeNext();

    await cancelTTSJob(req as AuthRequest, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });

  it('calls next with error when cancelJob throws', async () => {
    const err = new Error('DB error');
    mockTtsService.cancelJob.mockRejectedValueOnce(err);
    const req = makeReq({ params: { jobId: 'job-abc' } });
    const next = makeNext();

    await cancelTTSJob(req as AuthRequest, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// listVoices
// ---------------------------------------------------------------------------
describe('listVoices', () => {
  const mockVoices = [
    { id: 'v1', name: 'Sarah', language: 'en', provider: 'elevenlabs' as const },
    { id: 'v2', name: 'US English (F)', language: 'en-US', provider: 'google' as const },
  ];

  it('returns voices wrapped in a voices key', () => {
    mockTtsService.getVoices.mockReturnValueOnce(mockVoices);
    const req = makeReq({ query: {} });
    const res = makeRes();

    listVoices(req as AuthRequest, res as unknown as Response, makeNext());

    expect(res.json).toHaveBeenCalledWith({ voices: mockVoices });
  });

  it('passes provider query param to getVoices', () => {
    mockTtsService.getVoices.mockReturnValueOnce([mockVoices[0]]);
    const req = makeReq({ query: { provider: 'elevenlabs' } });

    listVoices(req as AuthRequest, makeRes() as unknown as Response, makeNext());

    expect(mockTtsService.getVoices).toHaveBeenCalledWith('elevenlabs');
  });

  it('calls getVoices with undefined when no provider query param', () => {
    mockTtsService.getVoices.mockReturnValueOnce(mockVoices);
    const req = makeReq({ query: {} });

    listVoices(req as AuthRequest, makeRes() as unknown as Response, makeNext());

    expect(mockTtsService.getVoices).toHaveBeenCalledWith(undefined);
  });

  it('calls next with error when getVoices throws', () => {
    const err = new Error('Config error');
    mockTtsService.getVoices.mockImplementationOnce(() => { throw err; });
    const next = makeNext();

    listVoices(makeReq() as AuthRequest, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
