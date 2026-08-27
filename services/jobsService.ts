// Lightweight in-memory job backend used by useJobStream's polling fallback and the
// video transcode UI. Stands in for the real `VideoService` API client — the wire
// shape (JobProgressEvent) matches what a real socket/poll backend would emit so
// swapping in a real client later is a one-file change.

export type JobType = 'tts' | 'video' | 'export' | 'bulk-action';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  /** null = indeterminate (backend has no percentage to report) */
  progress: number | null;
  /** monotonic clock used to drop out-of-order/duplicate events */
  updatedAt: number;
  resultUrl?: string;
  error?: string;
}

export interface VideoPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  bitrateKbps: number;
}

export const VIDEO_PRESETS: VideoPreset[] = [
  { id: 'ig-reel', label: 'Instagram Reel (1080×1920)', width: 1080, height: 1920, bitrateKbps: 6000 },
  { id: 'tiktok', label: 'TikTok (1080×1920)', width: 1080, height: 1920, bitrateKbps: 6000 },
  { id: 'yt-shorts', label: 'YouTube Shorts (1080×1920)', width: 1080, height: 1920, bitrateKbps: 8000 },
  { id: 'fb-feed', label: 'Facebook Feed (1080×1080)', width: 1080, height: 1080, bitrateKbps: 4000 },
  { id: 'linkedin', label: 'LinkedIn (1920×1080)', width: 1920, height: 1080, bitrateKbps: 5000 },
  { id: 'x-video', label: 'X / Twitter (1280×720)', width: 1280, height: 720, bitrateKbps: 3500 },
];

export interface VideoJob {
  id: string;
  label: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  presetId: string;
  status: JobStatus;
  progress: number | null;
  outputUrl?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, VideoJob>();
let counter = 0;

function simulateProgress(job: VideoJob) {
  job.status = 'processing';
  const willFail = Math.random() < 0.15;
  const totalTicks = 8;
  let tick = 0;
  const interval = setInterval(() => {
    if (!jobs.has(job.id)) {
      clearInterval(interval);
      return;
    }
    tick += 1;
    if (willFail && tick === Math.ceil(totalTicks * 0.6)) {
      job.status = 'failed';
      job.error = 'Encoder exited with an error: unsupported codec in the source file.';
      clearInterval(interval);
      return;
    }
    job.progress = Math.min(100, Math.round((tick / totalTicks) * 100));
    if (tick >= totalTicks) {
      job.status = 'completed';
      job.progress = 100;
      job.outputUrl = job.sourceUrl;
      clearInterval(interval);
    }
  }, 700);
}

export interface TranscodeParams {
  sourceUrl: string;
  thumbnailUrl?: string;
  label: string;
  presetId: string;
}

export function postVideoTranscode(params: TranscodeParams): VideoJob {
  const preset = VIDEO_PRESETS.find((p) => p.id === params.presetId);
  if (!preset) throw new Error(`Unknown preset: ${params.presetId}`);
  counter += 1;
  const job: VideoJob = {
    id: `vjob_${counter}_${Math.random().toString(36).slice(2, 8)}`,
    label: params.label,
    sourceUrl: params.sourceUrl,
    thumbnailUrl: params.thumbnailUrl,
    presetId: params.presetId,
    status: 'queued',
    progress: 0,
    createdAt: counter,
  };
  jobs.set(job.id, job);
  simulateProgress(job);
  return job;
}

export function retryVideoTranscode(jobId: string): VideoJob {
  const existing = jobs.get(jobId);
  if (!existing) throw new Error('Job not found');
  return postVideoTranscode({
    sourceUrl: existing.sourceUrl,
    thumbnailUrl: existing.thumbnailUrl,
    label: existing.label,
    presetId: existing.presetId,
  });
}

export function getVideoJobs(): VideoJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Used by useJobStream's polling fallback and by the shared socket's would-be emitter. */
export async function pollJobs(jobIds: string[]): Promise<JobProgressEvent[]> {
  const now = Date.now();
  return jobIds
    .map((id) => jobs.get(id))
    .filter((j): j is VideoJob => Boolean(j))
    .map((j) => ({
      jobId: j.id,
      status: j.status,
      progress: j.progress,
      updatedAt: now,
      resultUrl: j.outputUrl,
      error: j.error,
    }));
}
