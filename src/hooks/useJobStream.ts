import { useEffect, useRef, useCallback, useState } from 'react';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobType = 'video_transcoding' | 'ai_generation';

export interface JobProgressEvent {
  jobId: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface JobState {
  [jobId: string]: JobProgressEvent;
}

interface UseJobStreamOptions {
  /** Called on every job_progress event */
  onProgress?: (event: JobProgressEvent) => void;
  /** Called when a job transitions to the failed state */
  onJobFailed?: (event: JobProgressEvent) => void;
  /** Base URL — defaults to '' (same origin) */
  baseUrl?: string;
}

/**
 * useJobStream — subscribes to /api/realtime/stream via SSE.
 *
 * Automatically reconnects with exponential backoff on disconnect.
 * Pass the JWT token from your auth store.
 */
export function useJobStream(token: string | null, options: UseJobStreamOptions = {}) {
  const [jobs, setJobs] = useState<JobState>({});
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const { onProgress, onJobFailed, baseUrl = '' } = options;

  const connect = useCallback(() => {
    if (!token) return;

    // EventSource doesn't support custom headers natively in browsers,
    // so we pass the token as a query param (backend reads it as fallback).
    const url = `${baseUrl}/api/realtime/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('connected', () => {
      setConnected(true);
      retryDelay.current = 1000; // reset backoff on successful connect
    });

    es.addEventListener('job_progress', (e: MessageEvent) => {
      try {
        const event: JobProgressEvent = JSON.parse(e.data as string);
        setJobs((prev: JobState) => ({ ...prev, [event.jobId]: event }));
        onProgress?.(event);
        if (event.status === 'failed') {
          onJobFailed?.(event);
        }
      } catch {
        // malformed event — ignore
      }
    });

    // Handle explicit 'failed' SSE event type emitted by the backend
    es.addEventListener('failed', (e: MessageEvent) => {
      try {
        const event: JobProgressEvent = JSON.parse(e.data as string);
        const failedEvent: JobProgressEvent = { ...event, status: 'failed' };
        setJobs((prev: JobState) => ({ ...prev, [failedEvent.jobId]: failedEvent }));
        onProgress?.(failedEvent);
        onJobFailed?.(failedEvent);
      } catch {
        // malformed event — ignore
      }
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Exponential backoff: 1s → 2s → 4s → … capped at 30s
      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = delay * 2;
      retryRef.current = setTimeout(connect, delay);
    };
  }, [token, baseUrl, onProgress, onJobFailed]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  const clearJob = useCallback((jobId: string) => {
    setJobs((prev: JobState) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  /**
   * Re-enqueue a failed job by POSTing to the backend retry endpoint.
   * Clears the local failed state so the UI shows a fresh pending entry.
   */
  const retryJob = useCallback(
    async (jobId: string): Promise<void> => {
      if (!token) return;
      setJobs((prev: JobState) => {
        if (!prev[jobId]) return prev;
        return { ...prev, [jobId]: { ...prev[jobId], status: 'pending', progress: 0, error: undefined } };
      });
      await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    [token, baseUrl],
  );

  return { jobs, connected, clearJob, retryJob };
}
