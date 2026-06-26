import { EventEmitter } from 'events';

export type JobType = 'video_transcoding' | 'ai_generation';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobProgressEvent {
  jobId: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  progress: number; // 0-100
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200); // support many concurrent SSE connections
  }

  emitJobProgress(event: JobProgressEvent): void {
    this.emit(`job:${event.userId}`, event);
    this.emit('job:*', event); // wildcard for admin/monitoring
  }

  onUserJob(userId: string, listener: (event: JobProgressEvent) => void): void {
    this.on(`job:${userId}`, listener);
  }

  offUserJob(userId: string, listener: (event: JobProgressEvent) => void): void {
    this.off(`job:${userId}`, listener);
  }

  reset(): void {
    this.removeAllListeners();
  }
}

export const eventBus = new EventBus();

export const resetEventBus = (): void => {
  eventBus.reset();
};
