import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireSocket, releaseSocket } from '../lib/socket';
import { pollJobs, JobProgressEvent } from '../services/jobsService';

export type JobStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'polling';

export type JobStreamEvents = Record<string, JobProgressEvent>;

const POLL_INTERVAL_MS = 3000;
/** If the socket hasn't connected within this window, fall back to polling. */
const POLL_FALLBACK_DELAY_MS = 4000;

/**
 * Subscribes to progress for a set of job ids over the single shared socket
 * connection, falling back to interval polling when the socket can't connect
 * and switching back once it recovers. Out-of-order/duplicate events and
 * backwards progress are dropped.
 */
export function useJobStream(jobIds: string[]) {
  const [events, setEvents] = useState<JobStreamEvents>({});
  const [status, setStatus] = useState<JobStreamStatus>('connecting');
  const idsRef = useRef(jobIds);
  idsRef.current = jobIds;
  const lastSeenRef = useRef<Record<string, number>>({});

  const applyEvent = useCallback((evt: JobProgressEvent) => {
    const lastSeen = lastSeenRef.current[evt.jobId] ?? -Infinity;
    if (evt.updatedAt < lastSeen) return; // stale/duplicate delivery
    lastSeenRef.current[evt.jobId] = evt.updatedAt;

    setEvents((prev) => {
      const prevEvt = prev[evt.jobId];
      const goingBackwards =
        prevEvt &&
        evt.progress != null &&
        prevEvt.progress != null &&
        evt.progress < prevEvt.progress &&
        evt.status === prevEvt.status;
      if (goingBackwards) return prev;
      return { ...prev, [evt.jobId]: evt };
    });
  }, []);

  const key = jobIds.join(',');

  useEffect(() => {
    if (jobIds.length === 0) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const socket = acquireSocket();

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer || cancelled) return;
      setStatus('polling');
      const tick = async () => {
        try {
          const updates = await pollJobs(idsRef.current);
          updates.forEach(applyEvent);
        } catch {
          // transient poll failure — next tick will retry
        }
      };
      tick();
      pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    };

    const onConnect = () => {
      if (cancelled) return;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      stopPolling();
      setStatus('live');
      socket.emit('jobs:subscribe', { jobIds: idsRef.current });
    };

    const onDisconnected = () => {
      if (cancelled) return;
      setStatus('reconnecting');
      startPolling();
    };

    const onProgress = (evt: JobProgressEvent) => applyEvent(evt);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnected);
    socket.on('connect_error', onDisconnected);
    socket.on('reconnect_attempt', onDisconnected);
    socket.on('job:progress', onProgress);

    if (socket.connected) {
      onConnect();
    } else {
      fallbackTimer = setTimeout(() => {
        if (!socket.connected) startPolling();
      }, POLL_FALLBACK_DELAY_MS);
    }

    return () => {
      cancelled = true;
      socket.emit('jobs:unsubscribe', { jobIds: idsRef.current });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnected);
      socket.off('connect_error', onDisconnected);
      socket.off('reconnect_attempt', onDisconnected);
      socket.off('job:progress', onProgress);
      stopPolling();
      if (fallbackTimer) clearTimeout(fallbackTimer);
      releaseSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, applyEvent]);

  return { events, status };
}
