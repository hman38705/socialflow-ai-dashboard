import { OfflineQueue } from '../OfflineQueue';

function makeRedis(overrides: Record<string, jest.Mock> = {}) {
  return {
    lpush: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    lrange: jest.fn().mockResolvedValue([]),
    lrem: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    llen: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('OfflineQueue', () => {
  describe('constructor', () => {
    it('initialises without redis (in-memory only)', () => {
      const q = new OfflineQueue();
      expect(q).toBeDefined();
    });

    it('initialises with a redis client', () => {
      const redis = makeRedis();
      const q = new OfflineQueue(redis);
      expect(q).toBeDefined();
    });
  });

  describe('queueTransaction (in-memory)', () => {
    it('returns a unique string id', async () => {
      const q = new OfflineQueue();
      const id = await q.queueTransaction('xdr-data-1');
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^tx_/);
    });

    it('stores multiple transactions', async () => {
      const q = new OfflineQueue();
      await q.queueTransaction('xdr-1');
      await q.queueTransaction('xdr-2');
      const all = await q.getQueuedTransactions();
      expect(all).toHaveLength(2);
    });

    it('throws when queue exceeds max size', async () => {
      const q = new OfflineQueue(undefined, 2);
      await q.queueTransaction('xdr-1');
      await q.queueTransaction('xdr-2');
      await expect(q.queueTransaction('xdr-3')).rejects.toThrow(/full/);
    });
  });

  describe('queueTransaction (redis)', () => {
    it('calls redis lpush and expire', async () => {
      const redis = makeRedis();
      const q = new OfflineQueue(redis);
      await q.queueTransaction('xdr-redis');
      expect(redis.lpush).toHaveBeenCalled();
      expect(redis.expire).toHaveBeenCalled();
    });

    it('falls back to in-memory when redis.lpush rejects', async () => {
      const redis = makeRedis({ lpush: jest.fn().mockRejectedValue(new Error('redis down')) });
      const q = new OfflineQueue(redis);
      const id = await q.queueTransaction('xdr-fallback');
      expect(typeof id).toBe('string');
    });
  });

  describe('getQueuedTransactions', () => {
    it('returns in-memory queue when redis not set', async () => {
      const q = new OfflineQueue();
      await q.queueTransaction('xdr-a');
      const txs = await q.getQueuedTransactions();
      expect(txs[0].xdr).toBe('xdr-a');
    });

    it('parses items from redis', async () => {
      const entry = { id: 'tx_1', xdr: 'xdr-r', timestamp: Date.now() };
      const redis = makeRedis({ lrange: jest.fn().mockResolvedValue([JSON.stringify(entry)]) });
      const q = new OfflineQueue(redis);
      const txs = await q.getQueuedTransactions();
      expect(txs[0].xdr).toBe('xdr-r');
    });

    it('falls back to in-memory when redis.lrange rejects', async () => {
      const redis = makeRedis({ lrange: jest.fn().mockRejectedValue(new Error('redis fail')) });
      const q = new OfflineQueue(redis);
      await q.queueTransaction('xdr-mem');
      // llen returns 0, so queue size check passes; lpush rejects too
      const txs = await q.getQueuedTransactions();
      expect(Array.isArray(txs)).toBe(true);
    });
  });

  describe('removeTransaction', () => {
    it('removes from in-memory queue', async () => {
      const q = new OfflineQueue();
      const id = await q.queueTransaction('xdr-remove');
      await q.removeTransaction(id);
      const txs = await q.getQueuedTransactions();
      expect(txs.find((t) => t.id === id)).toBeUndefined();
    });

    it('calls redis lrem when redis is set', async () => {
      const entry = { id: 'tx_abc', xdr: 'xdr-x', timestamp: Date.now() };
      const redis = makeRedis({
        lrange: jest.fn().mockResolvedValue([JSON.stringify(entry)]),
        lrem: jest.fn().mockResolvedValue(1),
      });
      const q = new OfflineQueue(redis);
      await q.removeTransaction('tx_abc');
      expect(redis.lrem).toHaveBeenCalled();
    });
  });

  describe('clearQueue', () => {
    it('empties the in-memory queue', async () => {
      const q = new OfflineQueue();
      await q.queueTransaction('xdr-1');
      await q.clearQueue();
      expect(await q.getQueuedTransactions()).toHaveLength(0);
    });

    it('calls redis.del when redis is set', async () => {
      const redis = makeRedis();
      const q = new OfflineQueue(redis);
      await q.clearQueue();
      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe('getQueueSize', () => {
    it('returns in-memory length without redis', async () => {
      const q = new OfflineQueue();
      await q.queueTransaction('xdr-sz');
      expect(await q.getQueueSize()).toBe(1);
    });

    it('returns redis llen value', async () => {
      const redis = makeRedis({ llen: jest.fn().mockResolvedValue(5) });
      const q = new OfflineQueue(redis);
      expect(await q.getQueueSize()).toBe(5);
    });

    it('falls back to in-memory when redis.llen rejects', async () => {
      const redis = makeRedis({ llen: jest.fn().mockRejectedValue(new Error('fail')) });
      const q = new OfflineQueue(redis);
      expect(await q.getQueueSize()).toBe(0);
    });
  });

  describe('restoreFromRedis', () => {
    it('no-ops without redis', async () => {
      const q = new OfflineQueue();
      await expect(q.restoreFromRedis()).resolves.toBeUndefined();
    });

    it('populates in-memory queue from redis', async () => {
      const entry = { id: 'tx_restore', xdr: 'xdr-restored', timestamp: Date.now() };
      const redis = makeRedis({ lrange: jest.fn().mockResolvedValue([JSON.stringify(entry)]) });
      const q = new OfflineQueue(redis);
      await q.restoreFromRedis();
      const txs = await q.getQueuedTransactions();
      expect(txs[0].xdr).toBe('xdr-restored');
    });

    it('does not throw when redis.lrange rejects during restore', async () => {
      const redis = makeRedis({ lrange: jest.fn().mockRejectedValue(new Error('down')) });
      const q = new OfflineQueue(redis);
      await expect(q.restoreFromRedis()).resolves.toBeUndefined();
    });
  });
});
