/**
 * draftStore — local-only autosave for the post composer (FE-066).
 *
 * Rebuilt for FE-066. The tracking issue lists this as depending on FE-069
 * (`transactionDB`, which also gets a `drafts` store), but this module is
 * deliberately a separate, self-contained Dexie database rather than a
 * consumer of `transactionDB`:
 *
 *   - It keeps the composer's autosave path independent of the broader
 *     outbox/cache/blockchainQueue schema and its migrations, so a change
 *     to one never risks the other.
 *   - It lets this file (and its tests) stand on their own regardless of
 *     which of the two dependency-ordered issues lands first.
 *
 * If a future pass wants a single unified local database, the `drafts`
 * table here and the one in `transactionDB` can be merged — the record
 * shape is intentionally simple to make that low-risk.
 */
import Dexie, { type Table } from 'dexie';

const DB_NAME = 'SocialFlowDrafts';
const AUTOSAVE_DEBOUNCE_MS = 3_000;
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface ComposerDraft {
  /** Primary key, `${userId}:${draftId}`. */
  id: string;
  userId: string;
  draftId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

class DraftDatabase extends Dexie {
  drafts!: Table<ComposerDraft, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      drafts: 'id, userId, updatedAt, [userId+updatedAt]',
    });
    this.drafts = this.table('drafts');
  }
}

const db = new DraftDatabase();

function draftKey(userId: string, draftId: string): string {
  return `${userId}:${draftId}`;
}

/**
 * Write a draft immediately. Never throws — per the FE-066 acceptance
 * criteria, autosave failures must degrade silently to in-memory state and
 * never block typing. Callers that need to know whether the write
 * succeeded can inspect the resolved boolean.
 */
export async function saveDraftNow(userId: string, draftId: string, content: string): Promise<boolean> {
  const now = Date.now();
  try {
    const existing = await db.drafts.get(draftKey(userId, draftId));
    await db.drafts.put({
      id: draftKey(userId, draftId),
      userId,
      draftId,
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return true;
  } catch (error) {
    console.warn('draftStore: autosave failed, keeping content in memory only', error);
    return false;
  }
}

export async function getDraft(userId: string, draftId: string): Promise<ComposerDraft | undefined> {
  try {
    return await db.drafts.get(draftKey(userId, draftId));
  } catch (error) {
    console.warn('draftStore: failed to read draft', error);
    return undefined;
  }
}

/** Most recently edited draft for a user — used to offer "restore?" on reopen. */
export async function getLatestDraft(userId: string): Promise<ComposerDraft | undefined> {
  try {
    const rows = await db.drafts.where('userId').equals(userId).sortBy('updatedAt');
    return rows[rows.length - 1];
  } catch (error) {
    console.warn('draftStore: failed to read latest draft', error);
    return undefined;
  }
}

export async function listDrafts(userId: string): Promise<ComposerDraft[]> {
  try {
    return await db.drafts.where('userId').equals(userId).toArray();
  } catch (error) {
    console.warn('draftStore: failed to list drafts', error);
    return [];
  }
}

/** User explicitly discarded the offered draft. */
export async function discardDraft(userId: string, draftId: string): Promise<void> {
  try {
    await db.drafts.delete(draftKey(userId, draftId));
  } catch (error) {
    console.warn('draftStore: failed to discard draft', error);
  }
}

/** Clear all of a user's drafts — call on logout. */
export async function clearDraftsForUser(userId: string): Promise<void> {
  try {
    await db.drafts.where('userId').equals(userId).delete();
  } catch (error) {
    console.warn('draftStore: failed to clear drafts on logout', error);
  }
}

/** Delete drafts older than 30 days. Call once on startup. */
export async function pruneOldDrafts(maxAgeMs: number = MAX_DRAFT_AGE_MS): Promise<number> {
  try {
    const cutoff = Date.now() - maxAgeMs;
    return await db.drafts.where('updatedAt').below(cutoff).delete();
  } catch (error) {
    console.warn('draftStore: failed to prune old drafts', error);
    return 0;
  }
}

export interface DraftAutosaver {
  /** Call on every composer content change. Debounced 3s while dirty. */
  notifyChange(content: string): void;
  /** Force an immediate save of the last-known content, bypassing the debounce. */
  flush(): Promise<void>;
  /** Cancel any pending save and stop the autosaver (e.g. on composer unmount). */
  stop(): void;
}

/**
 * Creates a debounced autosaver for one composer instance. Content autosaves
 * to IndexedDB 3s after the last change while dirty; failures never throw or
 * block typing — the latest content always stays available in memory via
 * closure state, whether or not the write succeeded.
 */
export function createDraftAutosaver(userId: string, draftId: string): DraftAutosaver {
  let latestContent = '';
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const persist = async (): Promise<void> => {
    if (!dirty || stopped) return;
    const contentToSave = latestContent;
    dirty = false;
    await saveDraftNow(userId, draftId, contentToSave);
  };

  return {
    notifyChange(content: string): void {
      if (stopped) return;
      latestContent = content;
      dirty = true;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void persist();
      }, AUTOSAVE_DEBOUNCE_MS);
    },

    async flush(): Promise<void> {
      clearTimer();
      await persist();
    },

    stop(): void {
      stopped = true;
      clearTimer();
    },
  };
}

export const draftAutosaveIntervalMs = AUTOSAVE_DEBOUNCE_MS;
export const draftMaxAgeMs = MAX_DRAFT_AGE_MS;
export { DraftDatabase };
/** Exposed for tests that need to simulate write failures (e.g. quota errors). */
export { db as draftDb };
