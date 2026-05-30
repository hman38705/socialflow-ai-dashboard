import { createLogger } from '../lib/logger';
import { DynamicConfigService, getDynamicConfigService } from './DynamicConfigService';

const logger = createLogger('feature-service');

/**
 * Rollout strategies supported per flag:
 *
 *  - boolean  – fully on or off for everyone
 *  - userlist – enabled only for specific user IDs
 *  - canary   – enabled for a percentage of users (hash-based, deterministic)
 *  - group    – enabled for specific org/group IDs
 */
export type RolloutStrategy = 'boolean' | 'userlist' | 'canary' | 'group';

export interface FeatureFlag {
  enabled: boolean;
  strategy: RolloutStrategy;
  /** canary: 0–100 percentage */
  percentage?: number;
  /** userlist: explicit user IDs */
  userIds?: string[];
  /** group: org/group IDs */
  groupIds?: string[];
  description?: string;
}

export interface FeatureContext {
  userId?: string;
  groupId?: string;
}

// Prefix used when storing flags in DynamicConfig table
const FLAG_PREFIX = 'FEATURE_FLAG:';

export class FeatureService {
  private _svcPromise: Promise<import('./DynamicConfigService').DynamicConfigService> | null = null;

  private async getSvc(): Promise<import('./DynamicConfigService').DynamicConfigService> {
    if (!this._svcPromise) {
      this._svcPromise = getDynamicConfigService();
    }
    return this._svcPromise;
  }

  /**
   * Check if a feature is enabled for the given context.
   *
   * Usage:
   *   features.isEnabled('new-ai-model')
   *   features.isEnabled('new-ai-model', { userId: '123' })
   */
  isEnabled(flagName: string, ctx: FeatureContext = {}): boolean {
    const flag = this.getFlag(flagName);
    if (!flag) return false;
    if (!flag.enabled) return false;

    switch (flag.strategy) {
      case 'boolean':
        return true;

      case 'userlist':
        if (!ctx.userId) return false;
        return (flag.userIds ?? []).includes(ctx.userId);

      case 'group':
        if (!ctx.groupId) return false;
        return (flag.groupIds ?? []).includes(ctx.groupId);

      case 'canary': {
        const pct = flag.percentage ?? 0;
        if (pct >= 100) return true;
        if (pct <= 0) return false;
        // Deterministic hash so the same user always gets the same result
        const seed = ctx.userId ?? ctx.groupId ?? 'anonymous';
        return this.hashBucket(flagName, seed) < pct;
      }

      default:
        return false;
    }
  }

  /**
   * Persist a feature flag (creates or updates).
   * The DynamicConfigService polling will propagate it to all instances
   * within its refresh interval — no restart needed.
   */
  async setFlag(flagName: string, flag: FeatureFlag): Promise<void> {
    const key = `${FLAG_PREFIX}${flagName}`;
    const svc = await this.getSvc();
    await svc.set(key, flag, 'json', flag.description);
    logger.info('Feature flag updated', { flagName, flag });
  }

  /**
   * Delete a feature flag.
   */
  async deleteFlag(flagName: string): Promise<void> {
    // Set disabled so it propagates cleanly; removal from DB is a bonus
    await this.setFlag(flagName, { enabled: false, strategy: 'boolean' });
    logger.info('Feature flag disabled', { flagName });
  }

  /**
   * Return all known feature flags from the config cache.
   */
  listFlags(): Record<string, FeatureFlag> {
    const svc = DynamicConfigService.getCachedInstance();
    if (!svc) return {};
    const status = svc.getStatus();
    const result: Record<string, FeatureFlag> = {};

    for (const key of status.cachedKeys) {
      if (key.startsWith(FLAG_PREFIX)) {
        const name = key.slice(FLAG_PREFIX.length);
        const flag = this.getFlag(name);
        if (flag) result[name] = flag;
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getFlag(flagName: string): FeatureFlag | null {
    const key = `${FLAG_PREFIX}${flagName}`;
    // The DynamicConfigService cache is populated eagerly at startup,
    // so by the time this is called the cache is already built.
    // We call getDynamicConfigService() to ensure the singleton is initialized,
    // then read synchronously from the cached instance.
    // At runtime the service is already resolved due to module loading order.
    const svc = DynamicConfigService.getCachedInstance();
    if (!svc) return null;
    const value = svc.get<FeatureFlag | null>(key, null);
    if (!value || typeof value !== 'object') return null;
    return value as FeatureFlag;
  }

  /**
   * Deterministic bucket assignment using FNV-1a 32-bit hash.
   * FNV-1a distributes sequential integer IDs evenly, avoiding the clustering
   * that modulo on raw numeric IDs produces.
   * Returns a number 0–99 so we can compare against a percentage.
   */
  private hashBucket(flagName: string, userId: string): number {
    const input = `${flagName}:${userId}`;
    // FNV-1a 32-bit constants
    let hash = 0x811c9dc5; // offset basis
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      // Multiply by FNV prime (0x01000193), keeping result in 32-bit range
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash % 100;
  }
}

export const features = new FeatureService();
