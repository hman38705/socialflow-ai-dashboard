import { useCallback, useState } from 'react';
import { OpenAPI } from '../../api/core/OpenAPI';
import { request as apiRequest } from '../../api/core/request';
import type { ScheduledPost } from './schedulerTypes';

interface ToastState {
  message: string;
  tone: 'error' | 'info';
}

/**
 * Shared reschedule mutation for the month and week calendar views. Applies
 * an optimistic update to the caller's post list, persists the new
 * `scheduledAt` via the API, and rolls back on failure.
 *
 * Kept as a single hook so month/week drag, drop and keyboard reschedule
 * paths all share one mutation implementation (FE-073 requirement).
 */
export function useReschedulePost(
  posts: ScheduledPost[],
  setPosts: (updater: (prev: ScheduledPost[]) => ScheduledPost[]) => void
) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  const reschedulePost = useCallback(
    async (postId: string, nextIso: string) => {
      const target = posts.find((p) => p.id === postId);
      if (!target) return;

      const now = Date.now();
      if (new Date(nextIso).getTime() < now) {
        setToast({ message: 'Cannot reschedule a post into the past.', tone: 'error' });
        return;
      }

      const previousScheduledAt = target.scheduledAt;

      // Optimistic update.
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, scheduledAt: nextIso } : p))
      );

      try {
        await apiRequest(OpenAPI, {
          method: 'PATCH',
          url: '/posts/{id}',
          path: { id: postId },
          body: { scheduledAt: nextIso },
          mediaType: 'application/json',
        });
      } catch {
        // Rollback on failure.
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, scheduledAt: previousScheduledAt } : p))
        );
        setToast({ message: 'Failed to reschedule post. Please try again.', tone: 'error' });
      }
    },
    [posts, setPosts]
  );

  return { reschedulePost, toast, dismissToast };
}
