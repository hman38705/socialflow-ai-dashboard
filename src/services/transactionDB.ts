/**
 * transactionDB — the frontend's local IndexedDB store, built on Dexie.
 *
 * Rebuilt for FE-069. The previous implementation (`git show <pre-reset>:
 * src/services/transactionDB.ts`) only held a flat `transactions` store
 * written against the raw IndexedDB API. This rebuild switches to Dexie
 * (already a dependency) and expands the schema to the four stores the
 * frontend rebuild backlog needs:
 *
 *   - drafts:           composer drafts, namespaced per user (see FE-066's
 *                        `draftStore.ts`, which is intentionally a separate,
 *                        self-contained Dexie database rather than a
 *                        consumer of this one — see the note at the top of
 *                        that file for why).
 *   - outbox:            posts/actions queued for retry when the network is
 *                        unavailable.
 *   - cache:             short-lived, evictable response/asset cache.
 *   - blockchainQueue:   pending Stellar transactions awaiting submission.
 *
 * Verification note (FE-069 acceptance criteria: "Confirm and restore
 * whatever OfflineQueue.ts expects from this module"): as of this rebuild,
 * `src/blockchain/services/OfflineQueue.ts` persists queued transactions to
 * **Redis** (server-side) and does not import or reference `transactionDB`
 * / Dexie at all — there is no broken import on `master`. This module is
 * the browser-local counterpart used by the frontend composer/offline
 * flows; `blockchainQueue` is provided here for a future client-side
 * mirror of that queue, but nothing currently wires the two together. See
 * `transactionDB.test.ts` for a regression test that pins this finding.
 */
import Dexie, { type Table, type Transaction } from 'dexie';
import { traceDbQuery } from '../instrumentation';
import { AppError } from '../utils/AppError';
import { ErrorCode } from '../constants/ErrorCodes';

const DB_NAME = 'SocialFlowTransactionDB';

export interface DraftRecord {
  /** Primary key, `${userId}:${draftId}`. */
  id: string;
  userId: string;
  draftId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutboxRecord {
  id?: number;
  kind: string;
  payload: unknown;
  status: 'pending' | 'sending' | 'failed' | 'sent';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface CacheRecord {
  key: string;
  value: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface BlockchainQueueRecord {
  id?: number;
  xdr: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export type QuotaExceededListener = (message: string) => void;

/** True for both a raw DOMException and Dexie's wrapped QuotaExceededError. */
function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === Dexie.errnames.QuotaExceeded) {
    return true;
  }
  return error instanceof Error && error.name === Dexie.errnames.QuotaExceeded;
}

class TransactionDB extends Dexie {
  drafts!: Table<DraftRecord, string>;
  outbox!: Table<OutboxRecord, number>;
  cache!: Table<CacheRecord, string>;
  blockchainQueue!: Table<BlockchainQueueRecord, number>;

  private readonly quotaListeners = new Set<QuotaExceededListener>();
  private quotaToastActive = false;

  constructor() {
    super(DB_NAME);

    // v1 — initial schema.
    this.version(1).stores({
      drafts: 'id, userId, updatedAt',
      outbox: '++id, status, createdAt',
      cache: 'key, expiresAt',
      blockchainQueue: '++id, status, createdAt',
    });

    // v2 — add compound [status+createdAt] indexes so retry workers can
    // page through pending work in creation order without a full table
    // scan. This is purely additive: no store is dropped or recreated, so
    // existing rows survive automatically, and the upgrade() callback
    // backfills the `attempts` counter on any row written before it
    // existed so downstream code can always rely on it being a number.
    this.version(2)
      .stores({
        drafts: 'id, userId, updatedAt',
        outbox: '++id, status, createdAt, [status+createdAt]',
        cache: 'key, expiresAt',
        blockchainQueue: '++id, status, createdAt, [status+createdAt]',
      })
      .upgrade(async (tx: Transaction) => {
        await tx
          .table<OutboxRecord, number>('outbox')
          .toCollection()
          .modify((record) => {
            if (record.attempts === undefined) {
              record.attempts = 0;
            }
          });
        await tx
          .table<BlockchainQueueRecord, number>('blockchainQueue')
          .toCollection()
          .modify((record) => {
            if (record.attempts === undefined) {
              record.attempts = 0;
            }
          });
      });

    this.drafts = this.table('drafts');
    this.outbox = this.table('outbox');
    this.cache = this.table('cache');
    this.blockchainQueue = this.table('blockchainQueue');
  }

  /**
   * Subscribe to quota-exceeded notifications. Returns an unsubscribe
   * function. The UI layer (once it exists) can wire this to a toast.
   */
  onQuotaExceeded(listener: QuotaExceededListener): () => void {
    this.quotaListeners.add(listener);
    return () => this.quotaListeners.delete(listener);
  }

  private notifyQuotaExceeded(message: string): void {
    // Surface a single actionable toast at a time — repeated quota errors
    // in a tight loop must not spam the user with duplicate toasts.
    if (this.quotaToastActive) return;
    this.quotaToastActive = true;
    for (const listener of this.quotaListeners) {
      try {
        listener(message);
      } catch {
        // A broken listener must never take down a DB write.
      }
    }
    setTimeout(() => {
      this.quotaToastActive = false;
    }, 10_000);
  }

  /** Evict the `cache` store first, as instructed by the acceptance criteria. */
  private async evictCache(): Promise<number> {
    const count = await this.cache.count();
    if (count > 0) {
      await this.cache.clear();
    }
    return count;
  }

  /**
   * Run a write, and on quota-exceeded: evict `cache`, fire a single
   * actionable toast, then retry the write once. Any other error is
   * wrapped in an AppError so callers get a consistent shape.
   */
  private async withQuotaHandling<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw new AppError(
          ErrorCode.ERR_DATABASE_ERROR,
          `transactionDB.${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const evicted = await this.evictCache();
      this.notifyQuotaExceeded(
        evicted > 0
          ? `Storage is full — cleared ${evicted} cached item(s) to make room.`
          : 'Storage is full. Free up space to keep saving offline data.',
      );
      return await fn();
    }
  }

  // ---- drafts ----

  async putDraft(record: DraftRecord): Promise<void> {
    await traceDbQuery('transactionDB.putDraft', 'indexeddb', () =>
      this.withQuotaHandling('putDraft', async () => {
        await this.drafts.put(record);
      }),
    );
  }

  async getDraft(id: string): Promise<DraftRecord | undefined> {
    return traceDbQuery('transactionDB.getDraft', 'indexeddb', () => this.drafts.get(id));
  }

  async listDraftsForUser(userId: string): Promise<DraftRecord[]> {
    return traceDbQuery('transactionDB.listDraftsForUser', 'indexeddb', () =>
      this.drafts.where('userId').equals(userId).toArray(),
    );
  }

  async deleteDraft(id: string): Promise<void> {
    await traceDbQuery('transactionDB.deleteDraft', 'indexeddb', () => this.drafts.delete(id));
  }

  async deleteDraftsForUser(userId: string): Promise<void> {
    await traceDbQuery('transactionDB.deleteDraftsForUser', 'indexeddb', () =>
      this.drafts.where('userId').equals(userId).delete(),
    );
  }

  async pruneDraftsOlderThan(cutoff: number): Promise<number> {
    return traceDbQuery('transactionDB.pruneDraftsOlderThan', 'indexeddb', () =>
      this.drafts.where('updatedAt').below(cutoff).delete(),
    );
  }

  // ---- outbox ----

  async enqueueOutbox(entry: Omit<OutboxRecord, 'id'>): Promise<number> {
    return traceDbQuery('transactionDB.enqueueOutbox', 'indexeddb', () =>
      this.withQuotaHandling('enqueueOutbox', () => this.outbox.add(entry as OutboxRecord)),
    );
  }

  async getOutboxByStatus(status: OutboxRecord['status']): Promise<OutboxRecord[]> {
    return traceDbQuery('transactionDB.getOutboxByStatus', 'indexeddb', () =>
      this.outbox.where('status').equals(status).toArray(),
    );
  }

  async updateOutbox(id: number, changes: Partial<OutboxRecord>): Promise<void> {
    await traceDbQuery('transactionDB.updateOutbox', 'indexeddb', () =>
      this.outbox.update(id, changes),
    );
  }

  async removeOutbox(id: number): Promise<void> {
    await traceDbQuery('transactionDB.removeOutbox', 'indexeddb', () => this.outbox.delete(id));
  }

  // ---- cache ----

  async setCache(key: string, value: unknown, ttlMs: number): Promise<void> {
    const now = Date.now();
    await traceDbQuery('transactionDB.setCache', 'indexeddb', () =>
      this.withQuotaHandling('setCache', async () => {
        await this.cache.put({ key, value, createdAt: now, expiresAt: now + ttlMs });
      }),
    );
  }

  async getCache<T>(key: string): Promise<T | undefined> {
    const record = await traceDbQuery('transactionDB.getCache', 'indexeddb', () =>
      this.cache.get(key),
    );
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      await this.cache.delete(key);
      return undefined;
    }
    return record.value as T;
  }

  async clearExpiredCache(): Promise<number> {
    return traceDbQuery('transactionDB.clearExpiredCache', 'indexeddb', () =>
      this.cache.where('expiresAt').below(Date.now()).delete(),
    );
  }

  // ---- blockchainQueue ----

  async enqueueBlockchainTx(entry: Omit<BlockchainQueueRecord, 'id'>): Promise<number> {
    return traceDbQuery('transactionDB.enqueueBlockchainTx', 'indexeddb', () =>
      this.withQuotaHandling('enqueueBlockchainTx', () =>
        this.blockchainQueue.add(entry as BlockchainQueueRecord),
      ),
    );
  }

  async getBlockchainQueue(): Promise<BlockchainQueueRecord[]> {
    return traceDbQuery('transactionDB.getBlockchainQueue', 'indexeddb', () =>
      this.blockchainQueue.toArray(),
    );
  }

  async updateBlockchainTx(id: number, changes: Partial<BlockchainQueueRecord>): Promise<void> {
    await traceDbQuery('transactionDB.updateBlockchainTx', 'indexeddb', () =>
      this.blockchainQueue.update(id, changes),
    );
  }

  async removeBlockchainTx(id: number): Promise<void> {
    await traceDbQuery('transactionDB.removeBlockchainTx', 'indexeddb', () =>
      this.blockchainQueue.delete(id),
    );
  }
}

export const transactionDB = new TransactionDB();
export { TransactionDB };
