import type { ScheduledPost, ConflictWarningProps, Conflict } from '../../types/scheduler';

const MINUTE = 60_000;

const getStartOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const groupPostsByPlatform = (posts: ScheduledPost[]): Map<string, ScheduledPost[]> => {
  const groups = new Map<string, ScheduledPost[]>();

  posts.forEach((post) => {
    const key = post.platform.toLowerCase();
    const existing = groups.get(key) ?? [];
    existing.push(post);
    groups.set(key, existing);
  });

  return groups;
};

const findGapConflicts = (posts: ScheduledPost[], minGapMinutes: number, now: Date): Conflict[] => {
  const sorted = [...posts]
    .filter((post) => new Date(post.scheduledAt) >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const conflicts: Conflict[] = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const gap = new Date(current.scheduledAt).getTime() - new Date(previous.scheduledAt).getTime();
    const gapMinutes = gap / MINUTE;

    if (gapMinutes < minGapMinutes) {
      conflicts.push({
        type: 'gap',
        platform: previous.platform,
        message: `Two ${previous.platform} posts are scheduled only ${gapMinutes.toFixed(1)} minutes apart (minimum gap: ${minGapMinutes} minutes).`,
        conflictingPostIds: [previous.id, current.id],
      });
    }
  }

  return conflicts;
};

const findCapConflicts = (posts: ScheduledPost[], dailyCap: number, now: Date): Conflict[] => {
  const groups = groupPostsByPlatform(posts);
  const conflicts: Conflict[] = [];

  groups.forEach((platformPosts, platform) => {
    const futurePosts = platformPosts.filter((post) => new Date(post.scheduledAt) >= now);
    const dayBuckets = new Map<string, ScheduledPost[]>();

    futurePosts.forEach((post) => {
      const date = new Date(post.scheduledAt);
      const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
      const existing = dayBuckets.get(key) ?? [];
      existing.push(post);
      dayBuckets.set(key, existing);
    });

    dayBuckets.forEach((dayPosts) => {
      if (dayPosts.length > dailyCap) {
        conflicts.push({
          type: 'cap',
          platform,
          message: `${platform} has ${dayPosts.length} posts scheduled on one day (daily cap: ${dailyCap}).`,
          conflictingPostIds: dayPosts.map((post) => post.id),
        });
      }
    });
  });

  return conflicts;
};

export const detectConflicts = ({
  posts,
  minGapMinutes,
  dailyCap,
  now,
}: ConflictWarningProps): Conflict[] => {
  const baseNow = now ?? new Date();
  const gapConflicts = findGapConflicts(posts, minGapMinutes, baseNow);
  const capConflicts = findCapConflicts(posts, dailyCap, baseNow);

  return [...gapConflicts, ...capConflicts];
};
