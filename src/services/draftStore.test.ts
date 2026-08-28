import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import {
  clearDraftsForUser,
  createDraftAutosaver,
  discardDraft,
  draftAutosaveIntervalMs,
  draftDb,
  getDraft,
  getLatestDraft,
  listDrafts,
  pruneOldDrafts,
  saveDraftNow,
} from './draftStore';

describe('draftStore', () => {
  afterEach(async () => {
    await Dexie.delete('SocialFlowDrafts');
    vi.useRealTimers();
  });

  describe('save / restore / discard', () => {
    it('saves and restores a draft', async () => {
      const ok = await saveDraftNow('user-1', 'composer-1', 'hello world');
      expect(ok).toBe(true);

      const draft = await getDraft('user-1', 'composer-1');
      expect(draft?.content).toBe('hello world');
    });

    it('offers the most recently updated draft for restore', async () => {
      await saveDraftNow('user-1', 'a', 'first');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await saveDraftNow('user-1', 'b', 'second');

      const latest = await getLatestDraft('user-1');
      expect(latest?.draftId).toBe('b');
    });

    it('discards a draft on explicit user action', async () => {
      await saveDraftNow('user-1', 'composer-1', 'to be discarded');
      await discardDraft('user-1', 'composer-1');

      const draft = await getDraft('user-1', 'composer-1');
      expect(draft).toBeUndefined();
    });
  });

  describe('per-user namespacing', () => {
    it('keeps drafts isolated between users and clears only one user on logout', async () => {
      await saveDraftNow('user-1', 'composer-1', 'user 1 draft');
      await saveDraftNow('user-2', 'composer-1', 'user 2 draft');

      expect(await listDrafts('user-1')).toHaveLength(1);
      expect(await listDrafts('user-2')).toHaveLength(1);

      await clearDraftsForUser('user-1');

      expect(await listDrafts('user-1')).toHaveLength(0);
      expect(await listDrafts('user-2')).toHaveLength(1);
    });
  });

  describe('pruning', () => {
    it('removes drafts older than 30 days but keeps recent ones', async () => {
      const now = Date.now();
      await saveDraftNow('user-1', 'stale', 'old content');
      await saveDraftNow('user-1', 'fresh', 'new content');

      // Backdate the "stale" draft's updatedAt directly, since saveDraftNow
      // always stamps "now".
      const staleId = 'user-1:stale';
      const db = new Dexie('SocialFlowDrafts');
      db.version(1).stores({ drafts: 'id, userId, updatedAt, [userId+updatedAt]' });
      await db.table('drafts').update(staleId, { updatedAt: now - 40 * 24 * 60 * 60 * 1000 });
      db.close();

      const removed = await pruneOldDrafts();
      expect(removed).toBe(1);

      expect(await getDraft('user-1', 'stale')).toBeUndefined();
      expect(await getDraft('user-1', 'fresh')).toBeDefined();
    });
  });

  describe('write failures are tolerated', () => {
    it('does not throw when the underlying write fails, and reports failure via the return value', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(draftDb.drafts, 'put').mockRejectedValueOnce(new Error('quota exceeded'));

      await expect(saveDraftNow('user-1', 'composer-1', 'content')).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('createDraftAutosaver', () => {
    it('debounces autosave to 3s after the last change while dirty', async () => {
      vi.useFakeTimers();
      const autosaver = createDraftAutosaver('user-1', 'composer-1');

      autosaver.notifyChange('h');
      autosaver.notifyChange('he');
      autosaver.notifyChange('hel');

      // No write should have happened yet — still within the debounce window.
      await vi.advanceTimersByTimeAsync(draftAutosaveIntervalMs - 100);
      let draft = await getDraft('user-1', 'composer-1');
      expect(draft).toBeUndefined();

      await vi.advanceTimersByTimeAsync(200);
      draft = await getDraft('user-1', 'composer-1');
      expect(draft?.content).toBe('hel');

      autosaver.stop();
    });

    it('flush() saves immediately, bypassing the debounce', async () => {
      const autosaver = createDraftAutosaver('user-1', 'composer-2');
      autosaver.notifyChange('final content');
      await autosaver.flush();

      const draft = await getDraft('user-1', 'composer-2');
      expect(draft?.content).toBe('final content');

      autosaver.stop();
    });

    it('stop() cancels any pending save', async () => {
      vi.useFakeTimers();
      const autosaver = createDraftAutosaver('user-1', 'composer-3');
      autosaver.notifyChange('should not persist');
      autosaver.stop();

      await vi.advanceTimersByTimeAsync(draftAutosaveIntervalMs + 500);
      const draft = await getDraft('user-1', 'composer-3');
      expect(draft).toBeUndefined();
    });
  });
});
