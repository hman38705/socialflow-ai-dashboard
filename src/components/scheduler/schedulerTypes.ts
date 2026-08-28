import type { Post } from '../../api/models/Post';

/**
 * A scheduled post as consumed by the calendar views. Extends the generated
 * `Post` model with the fields the scheduler UI needs (status/error info for
 * the post detail timeline and calendar chips).
 */
export interface ScheduledPost extends Post {
  id: string;
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  errorReason?: string;
}

export type SchedulerView = 'month' | 'week' | 'queue';

export interface RescheduleResult {
  post: ScheduledPost;
  previousScheduledAt: string;
}
