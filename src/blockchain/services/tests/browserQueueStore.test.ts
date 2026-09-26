import { OfflineQueue } from '../OfflineQueue';
import { createBrowserQueueStore } from '../browserQueueStore';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('OfflineQueue with browser store', () => {
  it('keeps queued transactions after a simulated reload', async () => {
    const storage = memoryStorage();
    const q1 = new OfflineQueue(createBrowserQueueStore(storage));
    const id = await q1.queueTransaction('AAAA');

    const q2 = new OfflineQueue(createBrowserQueueStore(storage));
    await q2.restoreFromRedis();
    const items = await q2.getQueuedTransactions();
    expect(items.map((t) => t.id)).toEqual([id]);
    expect(await q2.getQueueSize()).toBe(1);
  });

  it('removes and enforces max size', async () => {
    const storage = memoryStorage();
    const q = new OfflineQueue(createBrowserQueueStore(storage), 1);
    const id = await q.queueTransaction('A');
    await expect(q.queueTransaction('B')).rejects.toThrow('full');
    await q.removeTransaction(id);
    expect(await q.getQueueSize()).toBe(0);
  });
});
