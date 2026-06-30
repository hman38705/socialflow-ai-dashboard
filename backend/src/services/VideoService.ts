import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { Queue, Worker, Job } from 'bullmq';
import {
  TranscodingJob,
  VideoQuality,
  VideoFormat,
  TranscodedOutput,
  TranscodingOptions,
} from '../types/video';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../lib/logger';
import { eventBus } from '../lib/eventBus';
import { getRedisConnection } from '../config/runtime';

const logger = createLogger('VideoService');

export class UnsupportedFormatError extends Error {
  constructor(public readonly ext: string) {
    super(`Unsupported input format: .${ext}`);
    this.name = 'UnsupportedFormatError';
  }
}

const SUPPORTED_INPUT_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', 'ts', 'mts',
]);

function assertSupportedFormat(inputPath: string): void {
  const ext = path.extname(inputPath).replace(/^\./, '').toLowerCase();
  if (!SUPPORTED_INPUT_EXTENSIONS.has(ext)) {
    throw new UnsupportedFormatError(ext);
  }
}

const QUEUE_NAME = 'video-transcoding';

interface VideoJobPayload {
  jobId: string;
  inputPath: string;
  outputDir: string;
  qualities: VideoQuality[];
  formats: VideoFormat[];
  userId?: string;
}

// Default quality presets
const DEFAULT_QUALITIES: VideoQuality[] = [
  { name: '1080p', width: 1920, height: 1080, bitrate: '5000k' },
  { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
  { name: '480p', width: 854, height: 480, bitrate: '1000k' },
  { name: '360p', width: 640, height: 360, bitrate: '500k' },
];

const DEFAULT_FORMATS: VideoFormat[] = [
  { extension: 'mp4', codec: 'libx264', audioCodec: 'aac' },
  { extension: 'webm', codec: 'libvpx-vp9', audioCodec: 'libopus' },
];

let _queue: Queue | null = null;
let _worker: Worker | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    });
  }
  return _queue;
}

export async function transcodeVideo(
  job: TranscodingJob,
  quality: VideoQuality,
  format: VideoFormat,
): Promise<TranscodedOutput> {
  // Validate input format before touching ffmpeg (#1097)
  assertSupportedFormat(job.inputPath);

  const outputFilename = `video_${quality.name}.${format.extension}`;
  const outputPath = path.join(job.outputDir, outputFilename);

  return new Promise((resolve, reject) => {
    ffmpeg(job.inputPath)
      .videoCodec(format.codec)
      .audioCodec(format.audioCodec)
      .size(`${quality.width}x${quality.height}`)
      .videoBitrate(quality.bitrate)
      .audioBitrate('128k')
      .audioChannels(2)
      .audioFrequency(44100)
      .format(format.extension)
      .on('start', (commandLine: string) => {
        logger.info(`Starting transcoding: ${outputFilename}`, { commandLine });
      })
      .on('progress', (progress: { percent?: number }) => {
        if (progress.percent) {
          logger.info(`Processing ${outputFilename}: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', async () => {
        logger.info(`Completed: ${outputFilename}`);
        const stats = await fs.stat(outputPath);
        resolve({ quality: quality.name, format: format.extension, path: outputPath, size: stats.size });
      })
      .on('error', (err: Error) => {
        // Log cleanup errors rather than swallowing them (#1045)
        fs.rm(outputPath, { force: true }).catch((cleanupErr: Error) => {
          logger.warn(`Failed to remove partial output ${outputPath}:`, { error: cleanupErr });
        });
        reject(err);
      })
      .save(outputPath);
  });
}

export async function processVideoJob(bullJob: Job<VideoJobPayload>): Promise<void> {
  const { jobId, inputPath, outputDir, qualities, formats, userId } = bullJob.data;

  const job: TranscodingJob = {
    id: jobId,
    inputPath,
    outputDir,
    status: 'processing',
    progress: 0,
    qualities,
    formats,
    createdAt: new Date(),
    updatedAt: new Date(),
    outputs: [],
  };

  if (userId) {
    eventBus.emitJobProgress({ jobId, userId, type: 'video_transcoding', status: 'processing', progress: 0, message: 'Job processing' });
  }

  const totalTasks = qualities.length * formats.length;
  let completedTasks = 0;
  const outputs: TranscodedOutput[] = [];

  try {
    for (const quality of qualities) {
      for (const format of formats) {
        const outputPath = path.join(outputDir, `video_${quality.name}.${format.extension}`);
        try {
          const output = await transcodeVideo(job, quality, format);
          outputs.push(output);
          completedTasks++;
          const progress = Math.round((completedTasks / totalTasks) * 100);
          await bullJob.updateProgress(progress);
          if (userId) {
            eventBus.emitJobProgress({ jobId, userId, type: 'video_transcoding', status: 'processing', progress, message: `Transcoding ${progress}%` });
          }
        } catch (error) {
          await fs.rm(outputPath, { force: true }).catch(() => {});
          logger.error(`Failed to transcode ${quality.name} ${format.extension}:`, { error });
        }
      }
    }

    if (outputs.length === 0) {
      throw new Error('All transcoding attempts failed');
    }

    if (userId) {
      eventBus.emitJobProgress({ jobId, userId, type: 'video_transcoding', status: 'completed', progress: 100, message: 'Job completed' });
    }
  } finally {
    // Log cleanup errors so they don't silently mask the transcoding result (#1045)
    await fs.unlink(inputPath).catch((cleanupErr: Error) => {
      logger.warn(`Failed to delete temp input file ${inputPath}:`, { error: cleanupErr });
    });
  }
}

export function startVideoWorker(): void {
  if (_worker) return;

  _worker = new Worker(QUEUE_NAME, processVideoJob, { connection: getRedisConnection(), concurrency: 1 });

  _worker.on('completed', (job) => logger.info(`Video job completed`, { jobId: job.id }));
  _worker.on('failed', (job, err) => {
    logger.error(`Video job failed`, { jobId: job?.id, error: err.message });
    const { jobId, userId } = (job?.data ?? {}) as Partial<VideoJobPayload>;
    if (jobId && userId) {
      eventBus.emitJobProgress({ jobId, userId, type: 'video_transcoding', status: 'failed', progress: 0, message: 'Job failed', error: err.message });
    }
  });

  logger.info('Video transcoding worker started');
}

class VideoService {
  public async createTranscodingJob(
    inputPath: string,
    options: TranscodingOptions = {},
    userId?: string,
  ): Promise<string> {
    const jobId = uuidv4();
    const outputDir = options.outputDir || path.join(path.dirname(inputPath), 'transcoded', jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const payload: VideoJobPayload = {
      jobId,
      inputPath,
      outputDir,
      qualities: options.qualities || DEFAULT_QUALITIES,
      formats: options.formats || DEFAULT_FORMATS,
      userId,
    };

    await getQueue().add('transcode', payload, { jobId });
    logger.info(`Video transcoding job enqueued`, { jobId });
    return jobId;
  }

  public async getJob(jobId: string): Promise<TranscodingJob | undefined> {
    const bullJob = await getQueue().getJob(jobId);
    if (!bullJob) return undefined;
    return this.bullJobToTranscodingJob(bullJob);
  }

  public async getAllJobs(): Promise<TranscodingJob[]> {
    const queue = getQueue();
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
    ]);
    return [...waiting, ...active, ...completed, ...failed].map((j) =>
      this.bullJobToTranscodingJob(j),
    );
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    const bullJob = await getQueue().getJob(jobId);
    if (!bullJob) return false;
    await bullJob.remove();
    return true;
  }

  private bullJobToTranscodingJob(bullJob: Job<VideoJobPayload>): TranscodingJob {
    const { jobId, inputPath, outputDir, qualities, formats } = bullJob.data;
    const state = bullJob.finishedOn
      ? bullJob.failedReason
        ? 'failed'
        : 'completed'
      : bullJob.processedOn
        ? 'processing'
        : 'pending';

    return {
      id: jobId,
      inputPath,
      outputDir,
      status: state as TranscodingJob['status'],
      progress: typeof bullJob.progress === 'number' ? bullJob.progress : 0,
      qualities,
      formats,
      createdAt: new Date(bullJob.timestamp),
      updatedAt: new Date(bullJob.finishedOn ?? bullJob.processedOn ?? bullJob.timestamp),
      error: bullJob.failedReason,
      outputs: [],
    };
  }
}

export const videoService = new VideoService();
