import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../lib/logger';
import { eventBus } from '../lib/eventBus';
import { prisma } from '../lib/prisma';
import { ExternalServiceError, BadRequestError } from '../lib/errors';
import { ttsConfig } from '../config/tts.config';
import { audioMerger } from './AudioMerger';
import type {
  TTSJob,
  TTSJobRequest,
  TTSJobStatus,
  TTSProvider,
  TTSSegment,
  TTSSegmentResult,
  TTSVoice,
} from '../types/tts';

const logger = createLogger('TTSService');

class TTSService {
  async createJob(req: TTSJobRequest): Promise<string> {
    if (!req.segments?.length) {
      throw new BadRequestError('At least one text segment is required');
    }

    const jobId = uuidv4();

    await prisma.tTSJob.create({
      data: {
        id: jobId,
        status: 'pending',
        progress: 0,
        request: JSON.parse(JSON.stringify(req)),
        userId: req.userId ?? null,
      },
    });

    logger.info(`TTS job created`, { jobId, segments: req.segments.length });

    // Fire-and-forget — errors are caught and stored on the job
    this.processJob(jobId).catch(async (err) => {
      logger.error(`TTS job ${jobId} failed unexpectedly`, { err });
      try {
        await this.updateStatus(jobId, 'failed', String(err?.message ?? err));
      } catch (statusErr) {
        logger.error(`TTS job ${jobId} failed to persist failure status`, { statusErr });
      }
    });

    return jobId;
  }

  async getJob(jobId: string): Promise<TTSJob | undefined> {
    const row = await prisma.tTSJob.findUnique({ where: { id: jobId } });
    return row ? rowToJob(row) : undefined;
  }

  async getAllJobs(userId: string): Promise<TTSJob[]> {
    const rows = await prisma.tTSJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(rowToJob);
  }

  getVoices(provider?: TTSProvider): TTSVoice[] {
    return provider ? ttsConfig.voices.filter((v) => v.provider === provider) : ttsConfig.voices;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = await prisma.tTSJob.findUnique({ where: { id: jobId } });
    if (!job) return false;
    if (job.status === 'pending' || job.status === 'processing') {
      await this.updateStatus(jobId, 'failed', 'Cancelled by user');
    }
    return true;
  }

  // ── Processing ────────────────────────────────────────────────────────────

  private async processJob(jobId: string): Promise<void> {
    const row = await prisma.tTSJob.findUnique({ where: { id: jobId } });
    if (!row) return;
    const req = row.request as unknown as TTSJobRequest;

    await this.updateStatus(jobId, 'processing');

    const outputDir = path.join(process.cwd(), ttsConfig.outputDir, jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const provider = this.resolveProvider(req.provider);
    const total = req.segments.length;
    const segmentResults: TTSSegmentResult[] = [];

    for (let i = 0; i < total; i++) {
      const current = await prisma.tTSJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (current?.status === 'failed') return;

      const segment = req.segments[i];
      const audioPath = path.join(outputDir, `segment_${i}.mp3`);

      logger.info(`Synthesising segment ${i + 1}/${total}`, { jobId, provider });

      const durationMs = await this.synthesiseSegment(segment, audioPath, provider);
      segmentResults.push({ index: i, audioPath, durationMs, text: segment.text });

      const progress = Math.round(((i + 1) / total) * (req.videoPath ? 70 : 90));
      await this.updateProgress(jobId, progress);
    }

    // Merge all segments into one audio file
    const mergedAudioPath = path.join(outputDir, 'narration.mp3');
    await audioMerger.mergeAudioFiles(
      segmentResults.map((s) => s.audioPath),
      mergedAudioPath,
    );

    await prisma.tTSJob.update({
      where: { id: jobId },
      data: {
        segments: JSON.parse(JSON.stringify(segmentResults)),
        outputAudioPath: mergedAudioPath,
      },
    });

    await this.updateProgress(jobId, req.videoPath ? 80 : 95);

    if (req.videoPath) {
      const outputVideoPath = path.join(outputDir, 'output_with_narration.mp4');
      await audioMerger.mergeAudioIntoVideo(req.videoPath, mergedAudioPath, outputVideoPath);
      await prisma.tTSJob.update({
        where: { id: jobId },
        data: { outputVideoPath },
      });
    }

    await this.updateStatus(jobId, 'completed');
    logger.info(`TTS job completed`, { jobId, outputAudioPath: mergedAudioPath });
  }

  // ── Synthesis ─────────────────────────────────────────────────────────────

  private async synthesiseSegment(
    segment: TTSSegment,
    outputPath: string,
    provider: TTSProvider,
  ): Promise<number> {
    if (provider === 'elevenlabs') {
      return this.synthesiseElevenLabs(segment, outputPath);
    }
    return this.synthesiseGoogle(segment, outputPath);
  }

  private async synthesiseElevenLabs(segment: TTSSegment, outputPath: string): Promise<number> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new ExternalServiceError('ElevenLabs API key not configured', 'elevenlabs');

    const voiceId = segment.voiceId ?? ttsConfig.elevenlabs.defaultVoiceId;
    const url = `${ttsConfig.elevenlabs.apiUrl}/text-to-speech/${voiceId}`;

    const body = {
      text: segment.text.slice(0, ttsConfig.defaults.maxSegmentLength),
      model_id: ttsConfig.elevenlabs.model,
      voice_settings: {
        stability: segment.stability ?? ttsConfig.defaults.stability,
        similarity_boost: segment.similarityBoost ?? ttsConfig.defaults.similarityBoost,
        speed: segment.speed ?? ttsConfig.defaults.speed,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ExternalServiceError(`ElevenLabs error ${response.status}: ${err}`, 'elevenlabs');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    return Math.round((buffer.length / 16000) * 1000);
  }

  private async synthesiseGoogle(segment: TTSSegment, outputPath: string): Promise<number> {
    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) throw new ExternalServiceError('Google TTS API key not configured', 'google');

    const voiceId = segment.voiceId ?? 'en-US-Neural2-F';
    const [languageCode] = voiceId.split('-').slice(0, 2);
    const language = segment.language ?? `${languageCode}-${voiceId.split('-')[1]}`;

    const body = {
      input: { text: segment.text.slice(0, ttsConfig.defaults.maxSegmentLength) },
      voice: { languageCode: language, name: voiceId },
      audioConfig: {
        audioEncoding: ttsConfig.google.audioEncoding,
        speakingRate: segment.speed ?? ttsConfig.defaults.speed,
      },
    };

    const response = await fetch(`${ttsConfig.google.apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new ExternalServiceError(`Google TTS error ${response.status}: ${err}`, 'google');
    }

    const { audioContent } = (await response.json()) as { audioContent: string };
    const buffer = Buffer.from(audioContent, 'base64');
    await fs.writeFile(outputPath, buffer);

    return Math.round((buffer.length / 16000) * 1000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveProvider(preferred?: TTSProvider): TTSProvider {
    if (preferred === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
    if (preferred === 'google' && process.env.GOOGLE_TTS_API_KEY) return 'google';
    if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
    if (process.env.GOOGLE_TTS_API_KEY) return 'google';
    throw new ExternalServiceError(
      'No TTS provider configured. Set ELEVENLABS_API_KEY or GOOGLE_TTS_API_KEY.',
      'tts',
    );
  }

  private async updateStatus(jobId: string, status: TTSJobStatus, error?: string): Promise<void> {
    const progress = status === 'completed' ? 100 : undefined;

    await prisma.tTSJob.update({
      where: { id: jobId },
      data: {
        status,
        progress,
        error: error ?? null,
      },
    });

    const row = await prisma.tTSJob.findUnique({
      where: { id: jobId },
      select: { userId: true, progress: true },
    });

    if (row?.userId) {
      eventBus.emitJobProgress({
        jobId,
        userId: row.userId,
        type: 'ai_generation',
        status,
        progress: progress ?? row.progress,
        message: error ?? `TTS job ${status}`,
        error,
      });
    }
  }

  private async updateProgress(jobId: string, progress: number): Promise<void> {
    await prisma.tTSJob.update({
      where: { id: jobId },
      data: { progress },
    });

    const row = await prisma.tTSJob.findUnique({
      where: { id: jobId },
      select: { userId: true },
    });

    if (row?.userId) {
      eventBus.emitJobProgress({
        jobId,
        userId: row.userId,
        type: 'ai_generation',
        status: 'processing',
        progress,
        message: `Generating narration ${progress}%`,
      });
    }
  }
}

function rowToJob(row: {
  id: string;
  status: string;
  progress: number;
  request: unknown;
  outputAudioPath: string | null;
  outputVideoPath: string | null;
  segments: unknown;
  error: string | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TTSJob {
  return {
    id: row.id,
    status: row.status as TTSJobStatus,
    progress: row.progress,
    request: row.request as TTSJobRequest,
    outputAudioPath: row.outputAudioPath ?? undefined,
    outputVideoPath: row.outputVideoPath ?? undefined,
    segments: (row.segments as TTSSegmentResult[]) ?? [],
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const ttsService = new TTSService();
