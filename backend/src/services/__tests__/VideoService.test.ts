// refs: #1045 (swallowed cleanup errors), #1097
import path from 'path';

// ── mocks (must be declared before imports that trigger module evaluation) ──

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    getJob: jest.fn().mockResolvedValue(null),
    getWaiting: jest.fn().mockResolvedValue([]),
    getActive: jest.fn().mockResolvedValue([]),
    getCompleted: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('../../config/runtime', () => ({
  getRedisConnection: jest.fn().mockReturnValue({}),
}));

jest.mock('../../lib/eventBus', () => ({
  eventBus: { emitJobProgress: jest.fn() },
}));

const mockFfmpegInstance = {
  videoCodec: jest.fn().mockReturnThis(),
  audioCodec: jest.fn().mockReturnThis(),
  size: jest.fn().mockReturnThis(),
  videoBitrate: jest.fn().mockReturnThis(),
  audioBitrate: jest.fn().mockReturnThis(),
  audioChannels: jest.fn().mockReturnThis(),
  audioFrequency: jest.fn().mockReturnThis(),
  format: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
  save: jest.fn().mockReturnThis(),
};

jest.mock('fluent-ffmpeg', () => jest.fn(() => mockFfmpegInstance));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
  unlink: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
}));

// ── imports after mocks ──

import fs from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import { transcodeVideo, processVideoJob, UnsupportedFormatError } from '../VideoService';
import { TranscodingJob, VideoQuality, VideoFormat } from '../../types/video';
import { Job } from 'bullmq';

// ── helpers ──

function makeJob(inputPath = '/tmp/input.mp4', outputDir = '/tmp/out'): TranscodingJob {
  return {
    id: 'test-job-id',
    inputPath,
    outputDir,
    status: 'processing',
    progress: 0,
    qualities: [],
    formats: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    outputs: [],
  };
}

const QUALITY: VideoQuality = { name: '720p', width: 1280, height: 720, bitrate: '2500k' };
const FORMAT: VideoFormat = { extension: 'mp4', codec: 'libx264', audioCodec: 'aac' };

function simulateFfmpegEnd(): void {
  const onCalls: Record<string, Function> = {};
  mockFfmpegInstance.on.mockImplementation((event: string, handler: Function) => {
    onCalls[event] = handler;
    return mockFfmpegInstance;
  });
  mockFfmpegInstance.save.mockImplementation(() => {
    // Defer 'end' so the Promise chain is fully built first
    setImmediate(() => onCalls['end']?.());
    return mockFfmpegInstance;
  });
}

function simulateFfmpegError(err: Error): void {
  const onCalls: Record<string, Function> = {};
  mockFfmpegInstance.on.mockImplementation((event: string, handler: Function) => {
    onCalls[event] = handler;
    return mockFfmpegInstance;
  });
  mockFfmpegInstance.save.mockImplementation(() => {
    setImmediate(() => onCalls['error']?.(err));
    return mockFfmpegInstance;
  });
}

// ── tests ──

describe('transcodeVideo()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore fluent-ffmpeg chain: every method returns the instance for chaining
    (Object.keys(mockFfmpegInstance) as Array<keyof typeof mockFfmpegInstance>).forEach(
      (key) => (mockFfmpegInstance[key] as jest.Mock).mockReturnValue(mockFfmpegInstance),
    );
  });

  describe('happy path', () => {
    it('dispatches ffmpeg with the configured codec, size, and bitrate', async () => {
      simulateFfmpegEnd();
      (fs.stat as jest.Mock).mockResolvedValue({ size: 2048 });

      await transcodeVideo(makeJob(), QUALITY, FORMAT);

      expect(ffmpeg).toHaveBeenCalledWith('/tmp/input.mp4');
      expect(mockFfmpegInstance.videoCodec).toHaveBeenCalledWith('libx264');
      expect(mockFfmpegInstance.audioCodec).toHaveBeenCalledWith('aac');
      expect(mockFfmpegInstance.size).toHaveBeenCalledWith('1280x720');
      expect(mockFfmpegInstance.videoBitrate).toHaveBeenCalledWith('2500k');
      expect(mockFfmpegInstance.format).toHaveBeenCalledWith('mp4');
    });

    it('saves output to <outputDir>/video_<quality>.<ext>', async () => {
      simulateFfmpegEnd();
      (fs.stat as jest.Mock).mockResolvedValue({ size: 512 });

      await transcodeVideo(makeJob('/tmp/input.mp4', '/out'), QUALITY, FORMAT);

      expect(mockFfmpegInstance.save).toHaveBeenCalledWith(
        path.join('/out', 'video_720p.mp4'),
      );
    });

    it('resolves with quality, format, path, and size from fs.stat', async () => {
      simulateFfmpegEnd();
      (fs.stat as jest.Mock).mockResolvedValue({ size: 999 });

      const result = await transcodeVideo(makeJob('/tmp/input.mp4', '/out'), QUALITY, FORMAT);

      expect(result).toEqual({
        quality: '720p',
        format: 'mp4',
        path: path.join('/out', 'video_720p.mp4'),
        size: 999,
      });
    });
  });

  describe('UnsupportedFormatError', () => {
    it('throws before invoking ffmpeg for an unsupported input extension', async () => {
      const job = makeJob('/tmp/input.xyz');

      await expect(transcodeVideo(job, QUALITY, FORMAT)).rejects.toBeInstanceOf(
        UnsupportedFormatError,
      );
      expect(ffmpeg).not.toHaveBeenCalled();
    });

    it('throws UnsupportedFormatError with the offending extension', async () => {
      const job = makeJob('/tmp/clip.docx');

      await expect(transcodeVideo(job, QUALITY, FORMAT)).rejects.toThrow(
        /Unsupported input format: \.docx/,
      );
    });

    it('accepts supported input formats without throwing', async () => {
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1 });

      for (const ext of ['mp4', 'mov', 'avi', 'mkv', 'webm']) {
        simulateFfmpegEnd();
        await expect(
          transcodeVideo(makeJob(`/tmp/video.${ext}`), QUALITY, FORMAT),
        ).resolves.toBeDefined();
      }
    });
  });

  describe('transcoding failure — temp-file cleanup', () => {
    it('attempts to remove the partial output file on ffmpeg error', async () => {
      simulateFfmpegError(new Error('ffmpeg crashed'));

      await expect(transcodeVideo(makeJob(), QUALITY, FORMAT)).rejects.toThrow('ffmpeg crashed');

      expect(fs.rm).toHaveBeenCalledWith(
        path.join('/tmp/out', 'video_720p.mp4'),
        { force: true },
      );
    });

    it('logs cleanup errors instead of masking the original ffmpeg error (#1045)', async () => {
      simulateFfmpegError(new Error('encode failed'));
      (fs.rm as jest.Mock).mockRejectedValue(new Error('disk full'));

      // The original transcoding error propagates — not the cleanup error
      await expect(transcodeVideo(makeJob(), QUALITY, FORMAT)).rejects.toThrow('encode failed');
    });
  });
});

describe('processVideoJob()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Object.keys(mockFfmpegInstance) as Array<keyof typeof mockFfmpegInstance>).forEach(
      (key) => (mockFfmpegInstance[key] as jest.Mock).mockReturnValue(mockFfmpegInstance),
    );
  });

  function makeBullJob(
    inputPath = '/tmp/input.mp4',
    qualities = [QUALITY],
    formats = [FORMAT],
  ): Job<any> {
    return {
      data: {
        jobId: 'bull-job-1',
        inputPath,
        outputDir: '/tmp/out',
        qualities,
        formats,
        userId: undefined,
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<any>;
  }

  describe('success path', () => {
    it('deletes the temp input file after successful transcoding', async () => {
      simulateFfmpegEnd();
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });

      await processVideoJob(makeBullJob());

      expect(fs.unlink).toHaveBeenCalledWith('/tmp/input.mp4');
    });

    it('updates job progress to 100 after all variants complete', async () => {
      simulateFfmpegEnd();
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });

      const bull = makeBullJob();
      await processVideoJob(bull);

      expect(bull.updateProgress).toHaveBeenLastCalledWith(100);
    });
  });

  describe('failure path', () => {
    it('still deletes the temp input file even when all transcoding fails', async () => {
      simulateFfmpegError(new Error('total failure'));

      // processVideoJob catches per-variant errors then throws "All transcoding attempts failed"
      await expect(processVideoJob(makeBullJob())).rejects.toThrow(
        'All transcoding attempts failed',
      );

      expect(fs.unlink).toHaveBeenCalledWith('/tmp/input.mp4');
    });

    it('cleans up temp input even when transcoding error is UnsupportedFormatError', async () => {
      const bull = makeBullJob('/tmp/input.txt');

      await expect(processVideoJob(bull)).rejects.toThrow('All transcoding attempts failed');

      expect(fs.unlink).toHaveBeenCalledWith('/tmp/input.txt');
    });

    it('logs cleanup error instead of masking the transcoding error (#1045)', async () => {
      simulateFfmpegError(new Error('encode failed'));
      (fs.unlink as jest.Mock).mockRejectedValue(new Error('unlink: permission denied'));

      // Original error must propagate
      await expect(processVideoJob(makeBullJob())).rejects.toThrow(
        'All transcoding attempts failed',
      );
    });
  });
});
