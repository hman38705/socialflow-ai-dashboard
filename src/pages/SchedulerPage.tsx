import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as apiRequest } from '../api/core/request';
import CalendarMonth from '../components/scheduler/CalendarMonth';
import CalendarWeek from '../components/scheduler/CalendarWeek';
import type { ScheduledPost, SchedulerView } from '../components/scheduler/schedulerTypes';

const VALID_VIEWS: SchedulerView[] = ['month', 'week', 'queue'];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
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

function rangeForView(view: SchedulerView, anchor: Date): { from: Date; to: Date } {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfMonth(anchor);
  return { from, to: addMonths(from, 1) };
}

async function fetchPostsInRange(from: Date, to: Date): Promise<ScheduledPost[]> {
  return apiRequest<ScheduledPost[]>(OpenAPI, {
    method: 'GET',
    url: '/posts',
    query: { from: from.getTime(), to: to.getTime() },
  });
}

/**
 * Shell page for the scheduler: owns the view switcher (month/week/queue),
 * date navigation, and the visible-range fetch (with adjacent-period
 * prefetch). Individual calendar rendering lives in CalendarMonth /
 * CalendarWeek; the queue list is a simple fallback until it ships.
 */
export default function SchedulerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const viewParam = searchParams.get('view');
  const view: SchedulerView = VALID_VIEWS.includes(viewParam as SchedulerView)
    ? (viewParam as SchedulerView)
    : 'month';

  const dateParam = searchParams.get('date');
  const anchor = useMemo(() => {
    const parsed = dateParam ? new Date(dateParam) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [dateParam]);

  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);

  const setView = (next: SchedulerView) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', next);
    setSearchParams(params);
  };

  const setAnchor = useCallback(
    (next: Date) => {
      const params = new URLSearchParams(searchParams);
      params.set('date', next.toISOString().slice(0, 10));
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const goToday = () => setAnchor(new Date());
  const goPrev = () => setAnchor(view === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1));
  const goNext = () => setAnchor(view === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 't' || e.key === 'T') goToday();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [anchor, view]);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = rangeForView(view, anchor);
    setLoading(true);
    fetchPostsInRange(from, to)
      .then((data) => {
        if (!cancelled) setPosts(data);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Prefetch the adjacent period so navigating forward/back feels instant.
    const adjacentAnchor = view === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1);
    const adjacent = rangeForView(view, adjacentAnchor);
    fetchPostsInRange(adjacent.from, adjacent.to).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [view, anchor]);

  const openComposerFor = (datetime: Date) => {
    navigate(`/composer?scheduledAt=${encodeURIComponent(datetime.toISOString())}`);
  };

  return (
    <div className="p-6 space-y-4" data-testid="scheduler-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">Scheduler</h1>

        <div className="flex items-center gap-2" role="group" aria-label="Scheduler view">
          {VALID_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
                view === v
                  ? 'bg-primary-blue text-white'
                  : 'bg-dark-surface text-gray-subtext hover:text-white'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous period"
            className="rounded-lg bg-dark-surface px-3 py-1.5 text-sm text-white"
          >
            ←
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg bg-dark-surface px-3 py-1.5 text-sm text-white"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next period"
            className="rounded-lg bg-dark-surface px-3 py-1.5 text-sm text-white"
          >
            →
          </button>
        </div>
      </header>

      {loading ? (
        <div
          className="h-96 animate-pulse rounded-xl bg-dark-surface"
          data-testid="scheduler-skeleton"
        />
      ) : view === 'month' ? (
        <CalendarMonth
          anchor={anchor}
          posts={posts}
          setPosts={setPosts}
          onSlotSelect={openComposerFor}
        />
      ) : view === 'week' ? (
        <CalendarWeek
          anchor={anchor}
          posts={posts}
          setPosts={setPosts}
          onSlotSelect={openComposerFor}
        />
      ) : (
        <ul className="space-y-2" data-testid="scheduler-queue">
          {posts
            .slice()
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
            .map((post) => (
              <li
                key={post.id}
                className="rounded-lg bg-dark-surface p-3 text-sm text-white flex justify-between"
              >
                <span className="truncate">{post.content}</span>
                <span className="text-gray-subtext font-mono">
                  {new Date(post.scheduledAt).toLocaleString()}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
