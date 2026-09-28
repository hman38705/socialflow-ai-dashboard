import { queueManager } from '../queues/queueManager';

// Job status types
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';

// Job info interface
export interface JobInfo {
  id: string;
  name: string;
  data: any;
  status: JobStatus;
  progress: number;
  attempts: number;
  createdAt: Date;
  processedAt?: Date;
  finishedAt?: Date;
  failedReason?: string;
  returnValue?: any;
}

// Queue stats interface
export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
}

// System stats interface
export interface SystemStats {
  queues: QueueStats[];
  totalQueues: number;
  totalJobs: number;
  timestamp: Date;
}

/**
 * JobMonitor - Service for monitoring and managing job queues
 */
export class JobMonitor {
  private eventListeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

  private monitoredQueues: Set<string> = new Set();

  constructor() {
    this.setupGlobalListeners();
  }

  /**
   * Attach listeners to every existing queue, and to any queue created later.
   * Queues are created at import time of their defining modules, so a one-time
   * snapshot here would silently miss queues imported after this module.
   */
  private setupGlobalListeners() {
    queueManager.getQueueNames().forEach((name) => this.attachQueueListeners(name));
    queueManager.on('queue-created', (name: string) => this.attachQueueListeners(name));
  }

  /**
   * Forward BullMQ queue events for a single queue (idempotent per queue name)
   */
  private attachQueueListeners(name: string) {
    if (this.monitoredQueues.has(name)) return;

    const events = queueManager.getQueueEvents(name);
    if (!events) return;

    this.monitoredQueues.add(name);

    events.on('completed', ({ jobId, returnvalue }) => {
      this.emit('job-completed', { queue: name, jobId, returnvalue });
    });

    events.on('failed', ({ jobId, failedReason }) => {
      this.emit('job-failed', { queue: name, jobId, failedReason });
    });

    events.on('stalled', ({ jobId }) => {
      this.emit('job-stalled', { queue: name, jobId });
    });

    events.on('progress', ({ jobId, data }) => {
      this.emit('job-progress', { queue: name, jobId, progress: data });
    });
  }

  /**
   * Get statistics for all queues
   */
  async getSystemStats(): Promise<SystemStats> {
    const queueNames = queueManager.getQueueNames();
    const queues: QueueStats[] = [];

    for (const name of queueNames) {
      const stats = await this.getQueueStats(name);
      if (stats) {
        queues.push({
          ...stats,
          total: stats.waiting + stats.active + stats.completed + stats.failed + stats.delayed,
        });
      }
    }

    return {
      queues,
      totalQueues: queues.length,
      totalJobs: queues.reduce((sum, q) => sum + q.total, 0),
      timestamp: new Date(),
    };
  }

  /**
   * Get statistics for a specific queue
   */
  async getQueueStats(name: string): Promise<QueueStats | null> {
    const stats = await queueManager.getQueueStats(name);
    if (!stats) return null;

    return {
      name,
      waiting: stats.waiting,
      active: stats.active,
      completed: stats.completed,
      failed: stats.failed,
      delayed: stats.delayed,
      paused: 0, // Not directly available
      total: stats.waiting + stats.active + stats.completed + stats.failed + stats.delayed,
    };
  }

  /**
   * Get jobs from a queue with optional status filter
   */
  async getJobs(
    queueName: string,
    status: JobStatus = 'waiting',
    start: number = 0,
    end: number = 20,
  ): Promise<JobInfo[]> {
    let jobs: any[] = [];

    switch (status) {
      case 'waiting':
        jobs = await queueManager.getWaitingJobs(queueName, start, end);
        break;
      case 'active':
        jobs = await queueManager.getActiveJobs(queueName, start, end);
        break;
      case 'failed':
        jobs = await queueManager.getFailedJobs(queueName, start, end);
        break;
      default:
        return [];
    }

    return jobs.map((job: any) => ({
      id: job.id || 'unknown',
      name: job.name || 'unknown',
      data: job.data,
      status,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      attempts: job.attemptsMade || 0,
      createdAt: new Date(job.timestamp || Date.now()),
      processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      failedReason: job.failedReason,
      returnValue: job.returnvalue,
    }));
  }

  /**
   * Get a specific job by ID
   */
  async getJob(queueName: string, jobId: string): Promise<JobInfo | null> {
    const queue = queueManager.getQueue(queueName);
    if (!queue) return null;

    const job = await queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();

    return {
      id: job.id || 'unknown',
      name: job.name || 'unknown',
      data: job.data,
      status: state as JobStatus,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      attempts: job.attemptsMade || 0,
      createdAt: new Date(job.timestamp || Date.now()),
      processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      failedReason: job.failedReason,
      returnValue: job.returnvalue,
    };
  }

  /**
   * Retry a failed job
   */
  async retryJob(queueName: string, jobId: string): Promise<boolean> {
    try {
      await queueManager.retryJob(queueName, jobId);
      return true;
    } catch (error) {
      console.error(`Failed to retry job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Retry all failed jobs in a queue
   */
  async retryAllFailed(queueName: string): Promise<number> {
    const failedJobs = await queueManager.getFailedJobs(queueName, 0, 100);
    let retried = 0;

    for (const job of failedJobs) {
      try {
        await job.retry();
        retried++;
      } catch (error) {
        console.error(`Failed to retry job ${job.id}:`, error);
      }
    }

    return retried;
  }

  /**
   * Remove a job
   */
  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    try {
      await queueManager.removeJob(queueName, jobId);
      return true;
    } catch (error) {
      console.error(`Failed to remove job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Pause a queue
   */
  async pauseQueue(name: string): Promise<boolean> {
    try {
      await queueManager.pauseQueue(name);
      return true;
    } catch (error) {
      console.error(`Failed to pause queue ${name}:`, error);
      return false;
    }
  }

  /**
   * Resume a queue
   */
  async resumeQueue(name: string): Promise<boolean> {
    try {
      await queueManager.resumeQueue(name);
      return true;
    } catch (error) {
      console.error(`Failed to resume queue ${name}:`, error);
      return false;
    }
  }

  /**
   * Clear all jobs from a queue
   */
  async clearQueue(name: string): Promise<boolean> {
    try {
      await queueManager.clearQueue(name);
      return true;
    } catch (error) {
      console.error(`Failed to clear queue ${name}:`, error);
      return false;
    }
  }

  /**
   * Get list of all queue names
   */
  getQueueNames(): string[] {
    return queueManager.getQueueNames();
  }

  /**
   * Event handling
   */
  on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }
}

// Singleton instance
export const jobMonitor = new JobMonitor();
