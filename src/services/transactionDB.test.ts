import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { TransactionDB } from './transactionDB';

describe('transactionDB', () => {
  afterEach(async () => {
    // fake-indexeddb keeps databases around between tests unless deleted.
    await Dexie.delete('SocialFlowTransactionDB');
  });

  describe('schema', () => {
    it('creates all four stores', async () => {
      const db = new TransactionDB();
      await db.open();

      expect(db.tables.map((table) => table.name).sort()).toEqual(
        ['blockchainQueue', 'cache', 'drafts', 'outbox'].sort(),
      );

      db.close();
    });
  });

  describe('drafts', () => {
    it('round-trips a draft and lists it back per-user', async () => {
      const db = new TransactionDB();
      const now = Date.now();

      await db.putDraft({
        id: 'user-1:draft-1',
        userId: 'user-1',
        draftId: 'draft-1',
        content: 'hello world',
        createdAt: now,
        updatedAt: now,
      });

      const fetched = await db.getDraft('user-1:draft-1');
      expect(fetched?.content).toBe('hello world');

      const forUser = await db.listDraftsForUser('user-1');
      expect(forUser).toHaveLength(1);

      const forOtherUser = await db.listDraftsForUser('user-2');
      expect(forOtherUser).toHaveLength(0);

      db.close();
    });

    it('prunes drafts older than a cutoff', async () => {
      const db = new TransactionDB();
      const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
      const recent = Date.now();

      await db.putDraft({
        id: 'user-1:old',
        userId: 'user-1',
        draftId: 'old',
        content: 'stale',
        createdAt: old,
        updatedAt: old,
      });
      await db.putDraft({
        id: 'user-1:recent',
        userId: 'user-1',
        draftId: 'recent',
        content: 'fresh',
        createdAt: recent,
        updatedAt: recent,
      });

      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const pruned = await db.pruneDraftsOlderThan(cutoff);
      expect(pruned).toBe(1);

      const remaining = await db.listDraftsForUser('user-1');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].draftId).toBe('recent');

      db.close();
    });

    it('clears all drafts for a user on logout', async () => {
      const db = new TransactionDB();
      const now = Date.now();
      await db.putDraft({
        id: 'u1:a',
        userId: 'u1',
        draftId: 'a',
        content: 'a',
        createdAt: now,
        updatedAt: now,
      });
      await db.putDraft({
        id: 'u1:b',
        userId: 'u1',
        draftId: 'b',
        content: 'b',
        createdAt: now,
        updatedAt: now,
      });
      await db.putDraft({
        id: 'u2:a',
        userId: 'u2',
        draftId: 'a',
        content: 'c',
        createdAt: now,
        updatedAt: now,
      });

      await db.deleteDraftsForUser('u1');

      expect(await db.listDraftsForUser('u1')).toHaveLength(0);
      expect(await db.listDraftsForUser('u2')).toHaveLength(1);

      db.close();
    });
  });

  describe('outbox and blockchainQueue', () => {
    it('enqueues, updates and removes outbox entries', async () => {
      const db = new TransactionDB();
      const now = Date.now();

      const id = await db.enqueueOutbox({
        kind: 'post.create',
        payload: { text: 'hi' },
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });

      const pending = await db.getOutboxByStatus('pending');
      expect(pending).toHaveLength(1);

      await db.updateOutbox(id, { status: 'sent' });
      expect(await db.getOutboxByStatus('pending')).toHaveLength(0);
      expect(await db.getOutboxByStatus('sent')).toHaveLength(1);

      await db.removeOutbox(id);
      expect(await db.getOutboxByStatus('sent')).toHaveLength(0);

      db.close();
    });

    it('enqueues and reads back the blockchain queue', async () => {
      const db = new TransactionDB();
      const now = Date.now();

      const id = await db.enqueueBlockchainTx({
        xdr: 'AAAA...',
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });

      const queue = await db.getBlockchainQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(id);

      db.close();
    });
  });

  describe('cache', () => {
    it('expires entries after their TTL', async () => {
      const db = new TransactionDB();
      await db.setCache('greeting', 'hi', -1); // already expired

      const value = await db.getCache('greeting');
      expect(value).toBeUndefined();

      db.close();
    });

    it('returns live values before expiry', async () => {
      const db = new TransactionDB();
      await db.setCache('greeting', { hi: true }, 60_000);

      const value = await db.getCache<{ hi: boolean }>('greeting');
      expect(value).toEqual({ hi: true });

      db.close();
    });
  });

  describe('migration v1 -> v2', () => {
    it('preserves existing rows and backfills the new attempts field', async () => {
      // Simulate a browser that already has the v1 schema on disk, written
      // before v2's `attempts` bookkeeping existed.
      const v1 = new Dexie('SocialFlowTransactionDB');
      v1.version(1).stores({
        drafts: 'id, userId, updatedAt',
        outbox: '++id, status, createdAt',
        cache: 'key, expiresAt',
        blockchainQueue: '++id, status, createdAt',
      });
      await v1.open();

      const now = Date.now();
      const outboxId = await v1.table('outbox').add({
        kind: 'post.create',
        payload: { text: 'pre-migration row' },
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        // no `attempts` — this row predates v2.
      });
      v1.close();

      // Opening TransactionDB (v1 + v2) against the same database name runs
      // the v2 upgrade() against the existing data.
      const db = new TransactionDB();
      await db.open();

      const migrated = await db.outbox.get(outboxId as number);
      expect(migrated?.payload).toEqual({ text: 'pre-migration row' });
      expect(migrated?.attempts).toBe(0); // backfilled by upgrade()

      db.close();
    });
  });

  describe('quota handling', () => {
    it('evicts the cache store, fires a single toast, then retries the write', async () => {
      const db = new TransactionDB();
      await db.setCache('stale-1', 'x', 60_000);
      await db.setCache('stale-2', 'y', 60_000);

      const addSpy = vi.spyOn(db.outbox, 'add');
      addSpy.mockRejectedValueOnce(new DOMException('quota exceeded', 'QuotaExceededError'));

      const onQuota = vi.fn();
      db.onQuotaExceeded(onQuota);

      const now = Date.now();
      const id = await db.enqueueOutbox({
        kind: 'post.create',
        payload: {},
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });

      expect(id).toBeDefined();
      expect(onQuota).toHaveBeenCalledTimes(1);
      expect(onQuota.mock.calls[0][0]).toMatch(/storage is full/i);

      // Cache store was evicted before the retry.
      const remainingCache = await db.getCache('stale-1');
      expect(remainingCache).toBeUndefined();

      db.close();
    });

    it('wraps non-quota errors in an AppError instead of retrying', async () => {
      const db = new TransactionDB();
      vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('disk read error'));

      const now = Date.now();
      await expect(
        db.enqueueOutbox({
          kind: 'post.create',
          payload: {},
          status: 'pending',
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toThrow(/enqueueOutbox failed/);

      db.close();
    });
  });

  describe('OfflineQueue integration', () => {
    it('OfflineQueue (backend Redis-backed queue) does not depend on transactionDB', async () => {
      // FE-069 asked us to "confirm and restore whatever OfflineQueue.ts
      // expects from this module" before starting. Verified: OfflineQueue
      // persists to Redis server-side and never imports Dexie or
      // transactionDB, so there is nothing to restore and no broken
      // import here. This test pins that finding as a regression guard —
      // if a future change makes OfflineQueue import transactionDB without
      // updating this test, that's a signal to revisit this assumption.
      const source = await import('node:fs/promises').then((fs) =>
        fs.readFile('src/blockchain/services/OfflineQueue.ts', 'utf-8'),
      );
      expect(source).not.toMatch(/transactionDB/);
      expect(source).not.toMatch(/from ['"]dexie['"]/);

      const { OfflineQueue } = await import('../blockchain/services/OfflineQueue');
      const queue = new OfflineQueue();
      const id = await queue.queueTransaction('AAAA...');
      expect(id).toMatch(/^tx_/);
    });
  });
});
