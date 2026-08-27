import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { WebhookDelivery } from '../../api/models/WebhookDelivery';

const SOCKET_PATH = '/socket.io';
const SOCKET_NAMESPACE = '/webhooks';
const POLL_INTERVAL_MS = 15000;

function dedupeId(delivery: WebhookDelivery) {
  return delivery.id;
}

export interface UseDeliveryStreamOptions {
  /** Rows already loaded (e.g. from the initial history fetch). Newest first. */
  initialDeliveries?: WebhookDelivery[];
  /**
   * Whether the delivery list is currently scrolled to the top. While true,
   * new deliveries are merged in immediately; while false they are held in a
   * pending buffer so the rows the user is reading never move or duplicate.
   */
  isAtTop: boolean;
  /** FE-107's polling fetch, used whenever the socket connection is unavailable. */
  fetchDeliveries: () => Promise<WebhookDelivery[]>;
  pollIntervalMs?: number;
}

export interface UseDeliveryStreamResult {
  /** The list to render. Never reordered/duplicated behind the user's back. */
  deliveries: WebhookDelivery[];
  /** Deliveries received but not yet merged in, because the user is scrolled away. */
  pendingCount: number;
  lastDelivery: WebhookDelivery | undefined;
  /** Call from the "N new deliveries" button to merge pending rows in. */
  releasePending: () => void;
  /** True while receiving live updates over the socket; false means polling fallback. */
  isLive: boolean;
}

/**
 * Keeps a webhook subscription's delivery history in sync in real time.
 * Prefers a socket.io stream; falls back to the FE-107 polling path whenever
 * the socket can't connect or drops.
 */
export function useDeliveryStream(
  subscriptionId: string,
  {
    initialDeliveries = [],
    isAtTop,
    fetchDeliveries,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: UseDeliveryStreamOptions,
): UseDeliveryStreamResult {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>(initialDeliveries);
  const [pending, setPending] = useState<WebhookDelivery[]>([]);
  const [isLive, setIsLive] = useState(false);

  const isAtTopRef = useRef(isAtTop);
  isAtTopRef.current = isAtTop;

  const knownIds = useRef<Set<string>>(
    new Set(initialDeliveries.map((d) => dedupeId(d)).filter(Boolean) as string[]),
  );

  const ingest = useCallback((incoming: WebhookDelivery[]) => {
    const fresh = incoming.filter((d) => {
      const id = dedupeId(d);
      if (!id || knownIds.current.has(id)) return false;
      knownIds.current.add(id);
      return true;
    });
    if (fresh.length === 0) return;

    if (isAtTopRef.current) {
      setDeliveries((prev) => [...fresh, ...prev]);
    } else {
      setPending((prev) => [...fresh, ...prev]);
    }
  }, []);

  const releasePending = useCallback(() => {
    setPending((prevPending) => {
      if (prevPending.length === 0) return prevPending;
      setDeliveries((prevDeliveries) => [...prevPending, ...prevDeliveries]);
      return [];
    });
  }, []);

  // Live socket connection.
  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    try {
      socket = io(SOCKET_NAMESPACE, {
        path: SOCKET_PATH,
        transports: ['websocket'],
        reconnectionAttempts: 5,
      });

      socket.on('connect', () => {
        if (cancelled) return;
        setIsLive(true);
        socket?.emit('subscribe', { subscriptionId });
      });

      socket.on('disconnect', () => {
        if (!cancelled) setIsLive(false);
      });

      socket.on('connect_error', () => {
        if (!cancelled) setIsLive(false);
      });

      socket.on('delivery:new', (payload: WebhookDelivery | WebhookDelivery[]) => {
        if (cancelled) return;
        ingest(Array.isArray(payload) ? payload : [payload]);
      });
    } catch {
      setIsLive(false);
    }

    return () => {
      cancelled = true;
      socket?.emit('unsubscribe', { subscriptionId });
      socket?.disconnect();
    };
  }, [subscriptionId, ingest]);

  // Polling fallback — only active while the socket isn't live.
  useEffect(() => {
    if (isLive) return undefined;

    let cancelled = false;
    const tick = async () => {
      try {
        const fetched = await fetchDeliveries();
        if (!cancelled) ingest(fetched);
      } catch {
        // Swallow: next tick retries.
      }
    };

    tick();
    const intervalId = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isLive, fetchDeliveries, ingest, pollIntervalMs]);

  return {
    deliveries,
    pendingCount: pending.length,
    lastDelivery: deliveries[0],
    releasePending,
    isLive,
  };
}

export default useDeliveryStream;
