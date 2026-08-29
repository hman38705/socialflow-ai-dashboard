import { useEffect, useMemo, useRef, useState } from 'react';
import { useReschedulePost } from './useReschedulePost';
import type { ScheduledPost } from './schedulerTypes';

const HOUR_HEIGHT_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const OPEN_SCROLL_HOUR = 8;

interface CalendarWeekProps {
  anchor: Date;
  posts: ScheduledPost[];
  setPosts: (updater: (prev: ScheduledPost[]) => ScheduledPost[]) => void;
  onSlotSelect?: (datetime: Date) => void;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

interface LaidOutPost {
  post: ScheduledPost;
  top: number;
  height: number;
  left: number;
  width: number;
}

/**
 * Lays out same-day posts side by side when their time ranges overlap, so
 * chips never clip each other. Assumes a fixed 30-minute display duration
 * per post (posts don't carry an explicit end time).
 */
function layoutDay(dayPosts: ScheduledPost[]): LaidOutPost[] {
  const DURATION_MIN = 30;
  const sorted = [...dayPosts].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  const columns: ScheduledPost[][] = [];
  const assignment = new Map<string, number>();

  for (const post of sorted) {
    const start = minutesSinceMidnight(new Date(post.scheduledAt));
    let placed = false;
    for (let col = 0; col < columns.length; col += 1) {
      const last = columns[col][columns[col].length - 1];
      const lastStart = minutesSinceMidnight(new Date(last.scheduledAt));
      if (start >= lastStart + DURATION_MIN) {
        columns[col].push(post);
        assignment.set(post.id, col);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([post]);
      assignment.set(post.id, columns.length - 1);
    }
  }

  // Determine overlap-cluster width: how many concurrent columns are active
  // around each post, so non-overlapping posts still get full width.
  const totalCols = columns.length || 1;

  return sorted.map((post) => {
    const start = minutesSinceMidnight(new Date(post.scheduledAt));
    const col = assignment.get(post.id) ?? 0;
    return {
      post,
      top: (start / 60) * HOUR_HEIGHT_PX,
      height: (DURATION_MIN / 60) * HOUR_HEIGHT_PX,
      left: (col / totalCols) * 100,
      width: 100 / totalCols,
    };
  });
}

export default function CalendarWeek({ anchor, posts, setPosts, onSlotSelect }: CalendarWeekProps) {
  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const { reschedulePost, toast, dismissToast } = useReschedulePost(posts, setPosts);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: OPEN_SCROLL_HOUR * HOUR_HEIGHT_PX });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const handleSlotClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.round((offsetY / HOUR_HEIGHT_PX) * 60);
    const slot = new Date(day);
    slot.setHours(0, Math.max(0, minutes), 0, 0);
    onSlotSelect(slot);
  };

  const nowKey = dayKey(now);
  const nowTop = (minutesSinceMidnight(now) / 60) * HOUR_HEIGHT_PX;

  return (
    <div data-testid="calendar-week">
      <div className="grid grid-cols-[48px_repeat(7,1fr)] text-xs text-gray-subtext mb-1">
        <div />
        {days.map((day) => (
          <div key={dayKey(day)} className="text-center py-1">
            <div>{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
            <div className="text-white">{day.getDate()}</div>
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="relative max-h-[560px] overflow-y-auto rounded-xl border border-dark-border">
        <div className="grid grid-cols-[48px_repeat(7,1fr)]">
          <div>
            {HOURS.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT_PX }}
                className="text-[10px] text-gray-subtext text-right pr-1 border-t border-dark-border"
              >
                {h}:00
              </div>
            ))}
          </div>

          {days.map((day) => {
            const key = dayKey(day);
            const laidOut = layoutDay(postsByDay.get(key) ?? []);
            return (
              <div
                key={key}
                className="relative border-l border-dark-border"
                style={{ height: HOUR_HEIGHT_PX * 24 }}
                data-testid={`week-day-${key}`}
                onClick={(e) => handleSlotClick(day, e)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const postId = e.dataTransfer.getData('text/plain');
                  if (!postId) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const offsetY = e.clientY - rect.top;
                  const minutes = Math.round((offsetY / HOUR_HEIGHT_PX) * 60);
                  const next = new Date(day);
                  next.setHours(0, minutes, 0, 0);
                  reschedulePost(postId, next.toISOString());
                }}
              >
                {HOURS.map((h) => (
                  <div key={h} style={{ height: HOUR_HEIGHT_PX }} className="border-t border-dark-border" />
                ))}

                {key === nowKey && (
                  <div
                    data-testid="now-indicator"
                    className="absolute left-0 right-0 h-px bg-primary-rose"
                    style={{ top: nowTop }}
                  />
                )}

                {laidOut.map(({ post, top, height, left, width }) => (
                  <div
                    key={post.id}
                    draggable
                    data-testid={`week-chip-${post.id}`}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', post.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute overflow-hidden rounded px-1 text-[10px] text-white cursor-grab ${
                      post.status === 'failed'
                        ? 'bg-primary-rose/70'
                        : post.status === 'published'
                          ? 'bg-trend-up/60'
                          : 'bg-primary-blue/70'
                    }`}
                    style={{
                      top,
                      height,
                      left: `${left}%`,
                      width: `calc(${width}% - 2px)`,
                    }}
                  >
                    {post.content}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {toast && (
        <div
          role="status"
          data-testid="scheduler-toast"
          className="fixed bottom-4 right-4 rounded-lg bg-primary-rose px-4 py-2 text-sm text-white shadow-elev-2"
          onClick={dismissToast}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
