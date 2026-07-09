/**
 * VideoService — temp-file cleanup error logging tests
 *
 * Verifies that all three swallowed .catch(() => {}) call sites now log
 * via logger.warn instead of silently ignoring cleanup failures:
 *   1. ffmpeg error handler: fs.rm(outputPath) inside transcodeVideo
 *   2. per-quality catch block: fs.rm(outputPath) inside processVideoJob
 *   3. finally block: fs.unlink(inputPath) inside processVideoJob
 */

// ── Logger spy – must be set up before module import ─────────────────────────

const warnSpy = jest.fn();
const errorSpy = jest.fn();
const infoSpy = jest.fn();

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ warn: warnSpy, error: errorSpy, info: infoSpy }),
}));

// ── eventBus stub ─────────────────────────────────────────────────────────────

jest.mock('../../lib/eventBus', () => ({
  eventBus: { emitJobProgress: jest.fn() },
}));

// ── Redis / runtime stub ──────────────────────────────────────────────────────

jest.mock('../../config/runtime', () => ({
  getRedisConnection: jest.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}));

// ── fs/promises mock ──────────────────────────────────────────────────────────

const mockRm = jest.fn();
const mockUnlink = jest.fn();
const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockStat = jest.fn().mockResolvedValue({ size: 1024 });

jest.mock('fs/promises', () => ({
  rm: (...args: any[]) => mockRm(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
  stat: (...args: any[]) => mockStat(...args),
}));

// ── fluent-ffmpeg mock ────────────────────────────────────────────────────────

type FfmpegCallback = (err?: Error) => void;

interface FfmpegChain {
  videoCodec: jest.Mock;
  audioCodec: jest.Mock;
  size: jest.Mock;
  videoBitrate: jest.Mock;
  audioBitrate: jest.Mock;
  audioChannels: jest.Mock;
  audioFrequency: jest.Mock;
  format: jest.Mock;
  on: jest.Mock;
  save: jest.Mock;
  _callbacks: Record<string, FfmpegCallback>;
}

let ffmpegChain: FfmpegChain;
const mockFfmpeg = jest.fn().mockImplementation(() => {
  ffmpegChain = {
    _callbacks: {},
    videoCodec: jest.fn().mockReturnThis(),
    audioCodec: jest.fn().mockReturnThis(),
    size: jest.fn().mockReturnThis(),
    videoBitrate: jest.fn().mockReturnThis(),
    audioBitrate: jest.fn().mockReturnThis(),
    audioChannels: jest.fn().mockReturnThis(),
    audioFrequency: jest.fn().mockReturnThis(),
    format: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (this: FfmpegChain, event: string, cb: FfmpegCallback) {
      ffmpegChain._callbacks[event] = cb;
      return ffmpegChain;
    }),
    save: jest.fn().mockImplementation(() => ffmpegChain),
  };
  return ffmpegChain;
});
(mockFfmpeg as unknown as { setFfmpegPath: jest.Mock }).setFfmpegPath = jest.fn();

jest.mock('fluent-ffmpeg', () => mockFfmpeg);

// ── bullmq mock — capture the Worker processor ───────────────────────────────

type BullProcessor = (job: any) => Promise<void>;
let capturedProcessor: BullProcessor | null = null;

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockQueueGetJob = jest.fn().mockResolvedValue(null);
const mockQueueGetWaiting = jest.fn().mockResolvedValue([]);
const mockQueueGetActive = jest.fn().mockResolvedValue([]);
const mockQueueGetCompleted = jest.fn().mockResolvedValue([]);
const mockQueueGetFailed = jest.fn().mockResolvedValue([]);

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getJob: mockQueueGetJob,
    getWaiting: mockQueueGetWaiting,
    getActive: mockQueueGetActive,
    getCompleted: mockQueueGetCompleted,
    getFailed: mockQueueGetFailed,
  })),
  Worker: jest.fn().mockImplementation((_name: string, processor: BullProcessor) => {
    capturedProcessor = processor;
    return { on: jest.fn() };
  }),
  Job: jest.fn(),
}));

// ── Import module AFTER mocks ─────────────────────────────────────────────────

import { startVideoWorker } from '../VideoService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBullJob(overrides: Partial<{
  jobId: string;
  inputPath: string;
  outputDir: string;
  qualities: any[];
  formats: any[];
  userId: string;
}> = {}): any {
  return {
    data: {
      jobId: 'test-job-id',
      inputPath: '/tmp/input.mp4',
      outputDir: '/tmp/transcoded',
      qualities: [{ name: '720p', width: 1280, height: 720, bitrate: '2500k' }],
      formats: [{ extension: 'mp4', codec: 'libx264', audioCodec: 'aac' }],
      ...overrides,
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

beforeAll(() => {
  startVideoWorker();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VideoService — temp-file cleanup error logging', () => {
  it('setup: startVideoWorker captures the processor', () => {
    expect(capturedProcessor).not.toBeNull();
  });

  describe('call site 1 — ffmpeg error handler (transcodeVideo)', () => {
    it('logs logger.warn when fs.rm rejects after ffmpeg error', async () => {
      const rmError = new Error('EPERM: permission denied');
      mockRm.mockRejectedValueOnce(rmError); // rm in ffmpeg error handler
      mockUnlink.mockResolvedValue(undefined); // finally cleanup succeeds

      // Stat won't be reached; ffmpeg will error before 'end'
      const jobPromise = capturedProcessor!(makeBullJob());

      // Let the bullJob start, then trigger the ffmpeg error
      await new Promise((r) => setImmediate(r));
      const ffmpegError = new Error('ffmpeg encoding failed');
      ffmpegChain._callbacks['error'](ffmpegError);

      // processVideoJob catches the transcoding error; wait for it to settle
      await jobPromise.catch(() => {});

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to clean up temp video file',
        expect.objectContaining({ path: expect.any(String), error: rmError }),
      );
    });
  });

  describe('call site 2 — per-quality/format catch block (processVideoJob)', () => {
    it('logs logger.warn when fs.rm rejects after transcoding failure', async () => {
      const rmError = new Error('ENOENT: no such file');
      // First rm call (call site 2): reject; second call won't happen
      mockRm.mockRejectedValue(rmError);
      mockUnlink.mockResolvedValue(undefined);

      const jobPromise = capturedProcessor!(makeBullJob());
      await new Promise((r) => setImmediate(r));

      // Trigger ffmpeg error to fail the transcoding
      const ffmpegError = new Error('encoding error');
      ffmpegChain._callbacks['error'](ffmpegError);

      await jobPromise.catch(() => {});

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to clean up temp video file',
        expect.objectContaining({ error: rmError }),
      );
    });
  });

  describe('call site 3 — finally block (processVideoJob)', () => {
    it('logs logger.warn when fs.unlink rejects for inputPath', async () => {
      // Make transcoding succeed so we reach the finally block normally
      mockRm.mockResolvedValue(undefined);
      const unlinkError = new Error('EBUSY: resource busy');
      mockUnlink.mockRejectedValueOnce(unlinkError);

      const jobPromise = capturedProcessor!(makeBullJob());
      await new Promise((r) => setImmediate(r));

      // Trigger ffmpeg 'end' to simulate successful transcoding
      ffmpegChain._callbacks['end']();

      await jobPromise.catch(() => {});

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to clean up temp video file',
        expect.objectContaining({ path: '/tmp/input.mp4', error: unlinkError }),
      );
    });

    it('does not throw when both transcoding succeeds and unlink rejects', async () => {
      mockRm.mockResolvedValue(undefined);
      mockUnlink.mockRejectedValueOnce(new Error('unlink failed'));

      const jobPromise = capturedProcessor!(makeBullJob());
      await new Promise((r) => setImmediate(r));
      ffmpegChain._callbacks['end']();

      await expect(jobPromise).resolves.toBeUndefined();
    });
  });
});
