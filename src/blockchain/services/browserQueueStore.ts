/**
 * Browser-side, localStorage-backed store exposing the small Redis-shaped
 * surface OfflineQueue uses (eval/hvals/hdel/hlen/del), so queued Stellar
 * transactions survive a page reload without a server-side Redis client.
 */
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'socialflow:offlineQueue:';

export function createBrowserQueueStore(storage?: StorageLike) {
  const store: StorageLike | undefined =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!store) return undefined;

  const read = (key: string): Record<string, string> => {
    try {
      return JSON.parse(store.getItem(PREFIX + key) ?? '{}');
    } catch {
      return {};
    }
  };
  const write = (key: string, hash: Record<string, string>) =>
    store.setItem(PREFIX + key, JSON.stringify(hash));

  return {
    // Mirrors OfflineQueue.ENQUEUE_SCRIPT: 1 if queued, 0 if full.
    async eval(_script: string, _numKeys: number, key: string, maxSize: number, field: string, value: string) {
      const hash = read(key);
      if (Object.keys(hash).length >= Number(maxSize)) return 0;
      hash[field] = value;
      write(key, hash);
      return 1;
    },
    async hvals(key: string) {
      return Object.values(read(key));
    },
    async hdel(key: string, field: string) {
      const hash = read(key);
      const had = field in hash;
      delete hash[field];
      write(key, hash);
      return had ? 1 : 0;
    },
    async hlen(key: string) {
      return Object.keys(read(key)).length;
    },
    async del(key: string) {
      store.removeItem(PREFIX + key);
      return 1;
    },
  };
}
