/**
 * OfflineQueue - Persists pending transactions to Redis
 * Prevents loss of queued transactions on server restart
 */

interface QueuedTransaction {
  id: string;
  xdr: string;
  timestamp: number;
}

export class OfflineQueue {
  private readonly QUEUE_KEY = 'stellar:offline:queue';
  private readonly QUEUE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly MAX_QUEUE_SIZE: number;
  private redis: any;
  private inMemoryQueue: QueuedTransaction[] = [];

  constructor(redisClient?: any, maxQueueSize = 1000) {
    this.redis = redisClient;
    this.MAX_QUEUE_SIZE = maxQueueSize;
    if (!this.redis) {
      console.warn('OfflineQueue: Redis client not provided, using in-memory storage only');
    }
  }

  /**
   * Queue a transaction for offline submission.
   * Throws if the queue has reached MAX_QUEUE_SIZE.
   */
  async queueTransaction(xdr: string): Promise<string> {
    const currentSize = await this.getQueueSize();
    if (currentSize >= this.MAX_QUEUE_SIZE) {
      throw new Error(`Offline queue is full (max ${this.MAX_QUEUE_SIZE} transactions)`);
    }

    const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const transaction: QueuedTransaction = {
      id,
      xdr,
      timestamp: Date.now(),
    };

    // Store in memory
    this.inMemoryQueue.push(transaction);

    // Persist to Redis if available
    if (this.redis) {
      try {
        await this.redis.lpush(
          this.QUEUE_KEY,
          JSON.stringify(transaction)
        );
        await this.redis.expire(this.QUEUE_KEY, this.QUEUE_TTL);
      } catch (error) {
        console.error('Failed to persist transaction to Redis:', error);
        // Continue with in-memory storage as fallback
      }
    }

    return id;
  }

  /**
   * Get all queued transactions
   */
  async getQueuedTransactions(): Promise<QueuedTransaction[]> {
    if (this.redis) {
      try {
        const items = await this.redis.lrange(this.QUEUE_KEY, 0, -1);
        return items.map((item: string) => JSON.parse(item));
      } catch (error) {
        console.error('Failed to retrieve transactions from Redis:', error);
        return this.inMemoryQueue;
      }
    }
    return this.inMemoryQueue;
  }

  /**
   * Remove a transaction from the queue
   */
  async removeTransaction(id: string): Promise<void> {
    // Remove from memory
    this.inMemoryQueue = this.inMemoryQueue.filter(tx => tx.id !== id);

    // Remove from Redis if available
    if (this.redis) {
      try {
        const items = await this.redis.lrange(this.QUEUE_KEY, 0, -1);
        for (let i = 0; i < items.length; i++) {
          const tx = JSON.parse(items[i]);
          if (tx.id === id) {
            await this.redis.lrem(this.QUEUE_KEY, 1, items[i]);
            break;
          }
        }
      } catch (error) {
        console.error('Failed to remove transaction from Redis:', error);
      }
    }
  }

  /**
   * Clear all queued transactions
   */
  async clearQueue(): Promise<void> {
    this.inMemoryQueue = [];

    if (this.redis) {
      try {
        await this.redis.del(this.QUEUE_KEY);
      } catch (error) {
        console.error('Failed to clear Redis queue:', error);
      }
    }
  }

  /**
   * Get queue size
   */
  async getQueueSize(): Promise<number> {
    if (this.redis) {
      try {
        return await this.redis.llen(this.QUEUE_KEY);
      } catch (error) {
        console.error('Failed to get queue size from Redis:', error);
        return this.inMemoryQueue.length;
      }
    }
    return this.inMemoryQueue.length;
  }

  /**
   * Restore queue from Redis on initialization
   */
  async restoreFromRedis(): Promise<void> {
    if (!this.redis) return;

    try {
      const items = await this.redis.lrange(this.QUEUE_KEY, 0, -1);
      this.inMemoryQueue = items.map((item: string) => JSON.parse(item));
      console.log(`Restored ${this.inMemoryQueue.length} transactions from Redis`);
    } catch (error) {
      console.error('Failed to restore queue from Redis:', error);
    }
  }
}
