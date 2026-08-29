import React, { useMemo, useState } from 'react';
import type { QueueItem, QueueListProps } from '../../types/scheduler';

const MINUTE = 60_000;

const groupByDay = (items: QueueItem[]): Map<string, QueueItem[]> => {
  const groups = new Map<string, QueueItem[]>();

  items.forEach((item) => {
    const date = new Date(item.scheduledAt);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  });

  return groups;
};

const formatDayKey = (key: string): string => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, day));
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTimeUntil = (iso: string): string => {
  const now = new Date();
  const target = new Date(iso);
  const diff = target.getTime() - now.getTime();

  if (diff <= 0) {
    return 'now';
  }

  const hours = Math.floor(diff / (MINUTE * 60));
  const minutes = Math.floor((diff % (MINUTE * 60)) / MINUTE);
  const seconds = Math.floor((diff % MINUTE) / 1000);

  if (hours > 0) {
    return `in ${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `in ${minutes}m ${seconds}s`;
  }

  return `in ${seconds}s`;
};

export const QueueList: React.FC<QueueListProps> = ({
  items,
  onReorder,
  onPublishNow,
  onEdit,
  onSkip,
  onDelete,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      ),
    [items],
  );

  const grouped = useMemo(() => groupByDay(sorted), [sorted]);

  const nextItem = useMemo(
    () => sorted.find((item) => new Date(item.scheduledAt) > new Date()),
    [sorted],
  );

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const next = [...sorted];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    onReorder(next);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      const next = [...sorted];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      onReorder(next);
    }

    if (event.key === 'ArrowDown' && index < sorted.length - 1) {
      event.preventDefault();
      const next = [...sorted];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      onReorder(next);
    }
  };

  return (
    <div className="space-y-4">
      {nextItem && (
        <div className="rounded-lg border border-blue-600 bg-gray-800 p-3 text-sm text-blue-300">
          <p className="font-medium">Next posting slot</p>
          <p>
            {new Date(nextItem.scheduledAt).toLocaleString()} ·{' '}
            {formatTimeUntil(nextItem.scheduledAt)}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([dayKey, dayItems]) => (
          <div key={dayKey} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">{formatDayKey(dayKey)}</h3>
              <span className="text-xs text-gray-400">
                {dayItems.length} post{dayItems.length === 1 ? '' : 's'}
              </span>
            </div>

            <ul className="space-y-2">
              {dayItems.map((item, index) => (
                <li
                  key={item.id}
                  draggable
                  onDragStart={() => handleDragStart(sorted.indexOf(item))}
                  onDragOver={(event) => handleDragOver(event, sorted.indexOf(item))}
                  onDrop={() => handleDrop(sorted.indexOf(item))}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onKeyDown={(event) => handleKeyDown(event, sorted.indexOf(item))}
                  tabIndex={0}
                  className={`flex items-center justify-between rounded border bg-gray-800 p-2 ${
                    dragOverIndex === sorted.indexOf(item) ? 'border-blue-500' : 'border-gray-700'
                  }`}
                >
                  <div className="flex-1">
                    <p className="text-sm text-white">
                      {new Date(item.scheduledAt).toLocaleTimeString()} · {item.platform}
                    </p>
                    {item.content && (
                      <p className="text-xs text-gray-400 line-clamp-1">{item.content}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPublishNow(item.id)}
                      className="text-xs text-green-400 hover:text-green-300"
                    >
                      Publish
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(item.id)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onSkip(item.id)}
                      className="text-xs text-yellow-400 hover:text-yellow-300"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {grouped.size === 0 && (
          <p className="text-sm text-gray-500">No upcoming posts in the queue.</p>
        )}
      </div>
    </div>
  );
};
