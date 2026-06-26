import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../lib/logger';
import { eventBus } from '../lib/eventBus';
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
  private jobs: Map<string, TTSJob> = new Map();

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Create and enqueue a TTS generation job.
   * Returns the jobId immediately; processing is async.
   */
  async createJob(req: TTSJobRequest): Promise<string> {
    if (!req.segments?.length) {
      throw new BadRequestError('At least one text segment is required');
    }

    const jobId = uuidv4();
    const job: TTSJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      request: req,
      segments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(jobId, job);
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

  getJob(jobId: string): TTSJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): TTSJob[] {
    return Array.from(this.jobs.values());
  }

  getVoices(provider?: TTSProvider): TTSVoice[] {
    return provider ? ttsConfig.voices.filter((v) => v.provider === provider) : ttsConfig.voices;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'pending' || job.status === 'processing') {
      this.updateStatus(jobId, 'failed', 'Cancelled by user');
    }
    return true;
  }

  // ── Processing ────────────────────────────────────────────────────────────

  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)!;
    this.updateStatus(jobId, 'processing');

    const outputDir = path.join(process.cwd(), ttsConfig.outputDir, jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const provider = this.resolveProvider(job.request.provider);
    const total = job.request.segments.length;
    const segmentResults: TTSSegmentResult[] = [];

    for (let i = 0; i < total; i++) {
      // Abort if cancelled mid-flight
      if (this.jobs.get(jobId)?.status === 'failed') return;

      const segment = job.request.segments[i];
      const audioPath = path.join(outputDir, `segment_${i}.mp3`);

      logger.info(`Synthesising segment ${i + 1}/${total}`, { jobId, provider });

      const durationMs = await this.synthesiseSegment(segment, audioPath, provider);
      segmentResults.push({ index: i, audioPath, durationMs, text: segment.text });

      const progress = Math.round(((i + 1) / total) * (job.request.videoPath ? 70 : 90));
      this.updateProgress(jobId, progress);
    }

    job.segments = segmentResults;

    // Merge all segments into one audio file
    const mergedAudioPath = path.join(outputDir, 'narration.mp3');
    await audioMerger.mergeAudioFiles(
      segmentResults.map((s) => s.audioPath),
      mergedAudioPath,
    );
    job.outputAudioPath = mergedAudioPath;
    this.updateProgress(jobId, job.request.videoPath ? 80 : 95);

    // Optionally merge narration into video
    if (job.request.videoPath) {
      const outputVideoPath = path.join(outputDir, 'output_with_narration.mp4');
      await audioMerger.mergeAudioIntoVideo(
        job.request.videoPath,
        mergedAudioPath,
        outputVideoPath,
      );
      job.outputVideoPath = outputVideoPath;
    }

    this.updateStatus(jobId, 'completed');
    logger.info(`TTS job completed`, { jobId, outputAudioPath: job.outputAudioPath });
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

    // Estimate duration: ~128kbps MP3 → bytes / 16000 ≈ ms
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
    // Auto-select based on available keys
    if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
    if (process.env.GOOGLE_TTS_API_KEY) return 'google';
    throw new ExternalServiceError(
      'No TTS provider configured. Set ELEVENLABS_API_KEY or GOOGLE_TTS_API_KEY.',
      'tts',
    );
  }

  private async updateStatus(jobId: string, status: TTSJobStatus, error?: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = status;
    job.updatedAt = new Date();
    if (error) job.error = error;
    if (status === 'completed') job.progress = 100;

    if (job.request.userId) {
      eventBus.emitJobProgress({
        jobId,
        userId: job.request.userId,
        type: 'ai_generation',
        status,
        progress: job.progress,
        message: error ?? `TTS job ${status}`,
        error,
      });
    }
  }

  private updateProgress(jobId: string, progress: number): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = progress;
    job.updatedAt = new Date();

    if (job.request.userId) {
      eventBus.emitJobProgress({
        jobId,
        userId: job.request.userId,
        type: 'ai_generation',
        status: 'processing',
        progress,
        message: `Generating narration ${progress}%`,
      });
    }
  }
}

export const ttsService = new TTSService();
