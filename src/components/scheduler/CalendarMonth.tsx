import React, { useMemo, useState } from 'react';
import { useReschedulePost } from './useReschedulePost';
import type { ScheduledPost } from './schedulerTypes';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS_PER_DAY = 3;

interface CalendarMonthProps {
  anchor: Date;
  posts: ScheduledPost[];
  setPosts: (updater: (prev: ScheduledPost[]) => ScheduledPost[]) => void;
  onSlotSelect?: (datetime: Date) => void;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

function isPastDay(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

/**
 * Builds the 6x7 grid of dates for the month containing `anchor`, always
 * starting on Sunday and including leading/trailing days from adjacent
 * months so the grid is a full rectangle. Uses local Date arithmetic so
 * DST transitions within the visible range fall out naturally.
 */
function buildMonthGrid(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  for (let i = 0; i < 42; i += 1) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export default function CalendarMonth({
  anchor,
  posts,
  setPosts,
  onSlotSelect,
}: CalendarMonthProps) {
  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const { reschedulePost, toast, dismissToast } = useReschedulePost(posts, setPosts);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [focusedChipId, setFocusedChipId] = useState<string | null>(null);
  const [overflowDay, setOverflowDay] = useState<string | null>(null);

  const postsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const post of posts) {
      if (!post.scheduledAt) continue;
      const key = dayKey(new Date(post.scheduledAt));
      const bucket = map.get(key) ?? [];
      bucket.push(post);
      map.set(key, bucket);
    }
    return map;
  }, [posts]);

  const commitReschedule = (postId: string, targetDay: Date) => {
    if (isPastDay(targetDay)) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const original = new Date(post.scheduledAt);
    const next = new Date(targetDay);
    next.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), 0);
    reschedulePost(postId, next.toISOString());
  };

  const handleKeyDown = (e: React.KeyboardEvent, post: ScheduledPost) => {
    const current = new Date(post.scheduledAt);
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      e.preventDefault();
      const delta =
        e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : 7;
      const proposed = new Date(current);
      proposed.setDate(proposed.getDate() + delta);
      commitReschedule(post.id, proposed);
    } else if (e.key === 'Escape') {
      setFocusedChipId(null);
    }
  };

  return (
    <div data-testid="calendar-month">
      <div className="grid grid-cols-7 text-center text-xs font-medium text-gray-subtext mb-1">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden border border-dark-border bg-dark-border">
        {grid.map((day) => {
          const key = dayKey(day);
          const dayPosts = postsByDay.get(key) ?? [];
          const inMonth = day.getMonth() === anchor.getMonth();
          const past = isPastDay(day);
          const visible = dayPosts.slice(0, MAX_CHIPS_PER_DAY);
          const overflowCount = dayPosts.length - visible.length;

          return (
            <div
              key={key}
              data-testid={`day-cell-${key}`}
              className={`min-h-[100px] p-1.5 bg-dark-bg ${!inMonth ? 'opacity-40' : ''} ${
                past ? 'bg-dark-elev' : ''
              }`}
              onDragOver={(e) => {
                if (!past) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const postId = e.dataTransfer.getData('text/plain') || draggingId;
                if (postId) commitReschedule(postId, day);
                setDraggingId(null);
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${isSameDay(day, new Date()) ? 'font-bold text-primary-blue' : 'text-gray-subtext'}`}
                >
                  {day.getDate()}
                </span>
                {onSlotSelect && !past && (
                  <button
                    type="button"
                    aria-label="Schedule post"
                    onClick={() => onSlotSelect(day)}
                    className="text-xs text-gray-subtext hover:text-white"
                  >
                    +
                  </button>
                )}
              </div>

              <div className="mt-1 space-y-1">
                {visible.map((post) => (
                  <div
                    key={post.id}
                    role="button"
                    tabIndex={0}
                    draggable={!past}
                    data-testid={`post-chip-${post.id}`}
                    onDragStart={(e) => {
                      setDraggingId(post.id);
                      e.dataTransfer.setData('text/plain', post.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    onFocus={() => setFocusedChipId(post.id)}
                    onBlur={() => setFocusedChipId((id) => (id === post.id ? null : id))}
                    onKeyDown={(e) => handleKeyDown(e, post)}
                    className={`truncate rounded px-1.5 py-0.5 text-[11px] text-white cursor-grab ${
                      post.status === 'failed'
                        ? 'bg-primary-rose/70'
                        : post.status === 'published'
                          ? 'bg-trend-up/60'
                          : 'bg-primary-blue/70'
                    } ${focusedChipId === post.id ? 'ring-2 ring-white' : ''}`}
                  >
                    {post.content}
                  </div>
                ))}
                {overflowCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setOverflowDay(key)}
                    className="text-[11px] text-gray-subtext hover:text-white"
                  >
                    +{overflowCount} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {overflowDay && (
        <div
          role="dialog"
          aria-label="All posts for day"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setOverflowDay(null)}
        >
          <div
            className="max-h-[70vh] w-80 overflow-y-auto rounded-xl bg-dark-elev p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-sm font-semibold text-white">{overflowDay}</h2>
            <ul className="space-y-1">
              {(postsByDay.get(overflowDay) ?? []).map((post) => (
                <li key={post.id} className="rounded bg-dark-surface p-2 text-xs text-white">
                  {post.content}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          data-testid="scheduler-toast"
          className="fixed bottom-4 right-4 rounded-lg bg-primary-rose px-4 py-2 text-sm text-white shadow-elev-2"
          onAnimationEnd={dismissToast}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
