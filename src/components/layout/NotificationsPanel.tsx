import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';

// === Types

export interface AppNotification {
  id: string;
  title: string;
  /** epoch ms */
  timestamp: number;
  read: boolean;
}

interface NotificationsSource {
  items: AppNotification[];
  /** Persist "read" for one item. Reject to trigger an optimistic rollback. */
  persistMarkRead: (id: string) => Promise<void>;
  /** Persist "read" for every item. Reject to trigger an optimistic rollback. */
  persistMarkAllRead: () => Promise<void>;
}

// === Default in-memory source
//
// FE-107 will replace this with a socket-backed feed (with polling fallback); the
// component only depends on the `NotificationsSource` shape, so that swap is local.

const SEED: AppNotification[] = [
  {
    id: 'n1',
    title: 'Instagram post hit 12k reach, 18% above forecast.',
    timestamp: Date.now() - 2 * 60_000,
    read: false,
  },
  {
    id: 'n2',
    title: 'TikTok post scheduled for 4:00 PM is ready.',
    timestamp: Date.now() - 60 * 60_000,
    read: false,
  },
  {
    id: 'n3',
    title: 'Reach model retrained; accuracy improved to 94%.',
    timestamp: Date.now() - 30 * 60 * 60_000,
    read: true,
  },
];

function useInMemoryNotifications(): NotificationsSource {
  const [items] = useState<AppNotification[]>(SEED);
  return {
    items,
    persistMarkRead: async () => {},
    persistMarkAllRead: async () => {},
  };
}

// === Helpers

const START_OF_TODAY = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function groupByRecency(items: AppNotification[]): {
  today: AppNotification[];
  earlier: AppNotification[];
} {
  const cutoff = START_OF_TODAY();
  return {
    today: items.filter((n) => n.timestamp >= cutoff),
    earlier: items.filter((n) => n.timestamp < cutoff),
  };
}

/** Accessible name for the bell. The badge caps visually at "9+"; the spoken count is exact. */
export function unreadLabel(count: number): string {
  return `${count} unread notifications`;
}

// === Component

interface NotificationsPanelProps {
  /** Injectable for tests / for the FE-107 socket source. */
  source?: NotificationsSource;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ source }) => {
  const fallback = useInMemoryNotifications();
  const { items: initialItems, persistMarkRead, persistMarkAllRead } = source ?? fallback;

  const [items, setItems] = useState<AppNotification[]>(initialItems);
  const [open, setOpen] = useState<boolean>(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);
  const groups = useMemo(() => groupByRecency(items), [items]);

  const markRead = useCallback(
    async (id: string) => {
      const prev = items;
      setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read: true } : n)));
      try {
        await persistMarkRead(id);
      } catch {
        setItems(prev);
      }
    },
    [items, persistMarkRead],
  );

  const markAllRead = useCallback(async () => {
    const prev = items;
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    try {
      await persistMarkAllRead();
    } catch {
      setItems(prev);
    }
  }, [items, persistMarkAllRead]);

  const renderItem = (n: AppNotification) => (
    <li key={n.id}>
      <button
        type="button"
        onClick={() => markRead(n.id)}
        className={`flex w-full items-start gap-2 border-b border-white/5 px-4 py-3 text-left last:border-0 hover:bg-white/5 ${
          n.read ? '' : 'bg-white/[0.03]'
        }`}
      >
        <span className="flex-1 text-xs leading-snug text-white/90">{n.title}</span>
        {!n.read && (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-rose" aria-hidden="true" />
        )}
      </button>
    </li>
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unreadCount > 0 ? unreadLabel(unreadCount) : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-dark-border text-gray-subtext hover:text-white"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary-rose px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l border-dark-border bg-dark-elev"
          >
            <div className="flex items-center justify-between border-b border-dark-border px-4 py-3">
              <p className="text-sm font-bold text-white">Notifications</p>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-[11px] font-bold text-primary-blue hover:underline"
                  >
                    Mark all as read
                  </button>
                )}
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="text-gray-subtext hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <BellOff className="h-8 w-8 text-gray-subtext" aria-hidden="true" />
                  <p className="text-sm font-semibold text-white/90">You are all caught up</p>
                  <p className="text-xs text-gray-subtext">New notifications will show up here.</p>
                </div>
              ) : (
                <>
                  {groups.today.length > 0 && (
                    <section aria-labelledby="notif-today">
                      <h3
                        id="notif-today"
                        className="px-4 pt-3 text-[10px] font-bold uppercase tracking-widest text-gray-subtext"
                      >
                        Today
                      </h3>
                      <ul>{groups.today.map(renderItem)}</ul>
                    </section>
                  )}
                  {groups.earlier.length > 0 && (
                    <section aria-labelledby="notif-earlier">
                      <h3
                        id="notif-earlier"
                        className="px-4 pt-3 text-[10px] font-bold uppercase tracking-widest text-gray-subtext"
                      >
                        Earlier
                      </h3>
                      <ul>{groups.earlier.map(renderItem)}</ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationsPanel;
