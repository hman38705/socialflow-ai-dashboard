export interface ScheduledPost {
  id: string;
  platform: string;
  scheduledAt: string;
  content?: string;
}

export interface ConflictWarningProps {
  posts: ScheduledPost[];
  minGapMinutes: number;
  dailyCap: number;
  now?: Date;
}

export interface Conflict {
  type: 'gap' | 'cap';
  platform: string;
  message: string;
  conflictingPostIds: string[];
}

export interface PostingSlot {
  id: string;
  day: number;
  time: string;
  platform: string;
}

export interface PostingScheduleProps {
  slots: PostingSlot[];
  onChange: (slots: PostingSlot[]) => void;
  minGapMinutes: number;
  platforms: string[];
}
