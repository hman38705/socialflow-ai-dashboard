import { prisma } from '../lib/prisma';
import { config } from '../config/config';

export enum ConfigKey {
  RATE_LIMIT_MAX = 'RATE_LIMIT_MAX',
  RATE_LIMIT_WINDOW_MS = 'RATE_LIMIT_WINDOW_MS',
  FEATURE_SENTIMENT_ANALYSIS = 'FEATURE_SENTIMENT_ANALYSIS',
  FEATURE_AI_GENERATOR = 'FEATURE_AI_GENERATOR',
  MAINTENANCE_MODE = 'MAINTENANCE_MODE',
  CACHE_TTL = 'CACHE_TTL',
  MODERATION_SENSITIVITY = 'MODERATION_SENSITIVITY',
}

export type ConfigType = 'string' | 'number' | 'boolean' | 'json';

type ChangeListener = (key: string, newValue: any) => void;

export class DynamicConfigService {
  private cache: Map<string, any> = new Map();
  private pollingInterval: any = null;
  private isPollingActive: boolean = false;
  private lastRefreshTimestamp: Date | null = null;
  private changeListeners: Map<string, ChangeListener[]> = new Map();

  private constructor(private refreshIntervalMs: number = 60000) {
    // Default 1 minute
    this.startPolling();
  }

  /**
   * Factory method that creates an instance with the cache already populated.
   * Use this instead of `new DynamicConfigService(...)`.
   */
  public static async create(refreshIntervalMs: number = 60000): Promise<DynamicConfigService> {
    const instance = new DynamicConfigService(refreshIntervalMs);
    await instance.refreshCache();
    return instance;
  }

  /**
   * Register a listener that fires whenever the given key changes value.
   * Returns an unsubscribe function.
   */
  public onChange(key: ConfigKey | string, listener: ChangeListener): () => void {
    const listeners = this.changeListeners.get(key) ?? [];
    listeners.push(listener);
    this.changeListeners.set(key, listeners);
    return () => {
      const updated = (this.changeListeners.get(key) ?? []).filter(l => l !== listener);
      this.changeListeners.set(key, updated);
    };
  }

  /**
   * Starts periodic polling of the database for configuration changes.
   * Polling is disabled in the test environment to avoid DB noise.
   * A ±20% jitter is applied to the interval to prevent thundering herd
   * when multiple replicas start simultaneously.
   */
  public startPolling(): void {
    if (this.pollingInterval) return;
    if (process.env.NODE_ENV === 'test') return;

    const jitter = this.refreshIntervalMs * 0.2 * (Math.random() * 2 - 1); // ±20%
    const interval = this.refreshIntervalMs + jitter;

    this.pollingInterval = setInterval(async () => {
      await this.refreshCache();
    }, interval);
  }

  /**
   * Stops the polling interval.
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Fetches all configuration from the database and updates the in-memory cache.
   */
  public async refreshCache(): Promise<void> {
    if (this.isPollingActive) return;
    this.isPollingActive = true;

    try {
      // Note: We use the prisma client.
      // Ensure the DynamicConfig table exists after the migration.
      const configs = await (prisma as any).dynamicConfig.findMany();

      const newCache = new Map<string, any>();
      for (const config of configs) {
        newCache.set(config.key, this.parseValue(config.value, config.type as ConfigType));
      }

      // Fire change listeners for any keys whose values changed
      for (const [key, newVal] of newCache) {
        const oldVal = this.cache.get(key);
        if (oldVal !== newVal) {
          this.notifyListeners(key, newVal);
        }
      }

      // Replace the live cache with the refreshed data
      this.cache = newCache;

      this.lastRefreshTimestamp = new Date();
      console.log(
        `[DynamicConfigService] Cache refreshed at ${this.lastRefreshTimestamp.toISOString()}. Loaded ${configs.length} configs.`,
      );
    } catch (error) {
      // If table doesn't exist yet, we just log it. In a real environment,
      // migrations would handle this before the service starts.
      console.error(
        '[DynamicConfigService] Failed to refresh config cache:',
        (error as Error).message,
      );
    } finally {
      this.isPollingActive = false;
    }
  }

  /**
   * Gets a configuration value by key.
   * @param key The configuration key
   * @param defaultValue Optional default value if the key is not found
   */
  public get<T>(key: ConfigKey | string, defaultValue?: T): T {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // Return a default if not found in cache and no defaultValue provided
    // This allows the app to function even if the DB is empty
    return this.getHardcodedDefault(key) as unknown as T;
  }

  /**
   * Sets a configuration value in both database and cache.
   */
  public async set(
    key: ConfigKey | string,
    value: any,
    type: ConfigType = 'string',
    description?: string,
  ): Promise<void> {
    const stringValue = type === 'json' ? JSON.stringify(value) : String(value);

    await (prisma as any).dynamicConfig.upsert({
      where: { key },
      update: { value: stringValue, type, description },
      create: { key, value: stringValue, type, description },
    });

    // Update local cache immediately
    const parsed = this.parseValue(stringValue, type);
    const oldVal = this.cache.get(key);
    this.cache.set(key, parsed);
    if (oldVal !== parsed) {
      this.notifyListeners(key, parsed);
    }
  }

  /**
   * Notifies all registered listeners for a given key.
   */
  private notifyListeners(key: string, newValue: any): void {
    const listeners = this.changeListeners.get(key) ?? [];
    for (const listener of listeners) {
      try {
        listener(key, newValue);
      } catch (err) {
        console.error(`[DynamicConfigService] Listener error for key "${key}":`, err);
      }
    }
  }

  /**
   * Parses the string value from the database based on its type.
   */
  private parseValue(value: string, type: ConfigType): any {
    switch (type) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'json':
        try {
          return JSON.parse(value);
        } catch (e) {
          console.error(
            `[DynamicConfigService] Failed to parse JSON value for config: ${value}`,
            e,
          );
          return null;
        }
      case 'string':
      default:
        return value;
    }
  }

  /**
   * Provides hardcoded defaults for common keys in case the DB is not yet populated.
   */
  private getHardcodedDefault(key: ConfigKey | string): any {
    const defaults: Record<string, any> = {
      [ConfigKey.RATE_LIMIT_MAX]: 100,
      [ConfigKey.RATE_LIMIT_WINDOW_MS]: 15 * 60 * 1000,
      [ConfigKey.FEATURE_SENTIMENT_ANALYSIS]: true,
      [ConfigKey.FEATURE_AI_GENERATOR]: true,
      [ConfigKey.MAINTENANCE_MODE]: false,
      [ConfigKey.CACHE_TTL]: 3600,
    };
    return defaults[key] ?? null;
  }

  public getStatus() {
    return {
      lastRefresh: this.lastRefreshTimestamp,
      isPolling: !!this.pollingInterval,
      keysCachedCount: this.cache.size,
      cachedKeys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton — initialized with the factory so the cache is populated before first use.
let _dynamicConfigServicePromise: Promise<DynamicConfigService> | null = null;
let _dynamicConfigServiceInstance: DynamicConfigService | null = null;

export async function getDynamicConfigService(): Promise<DynamicConfigService> {
  if (!_dynamicConfigServicePromise) {
    _dynamicConfigServicePromise = DynamicConfigService.create(
      config.DYNAMIC_CONFIG_POLL_INTERVAL_MS,
    ).then(instance => {
      _dynamicConfigServiceInstance = instance;
      return instance;
    });
  }
  return _dynamicConfigServicePromise;
}

// For synchronous access once the service has been initialized.
// Returns null if the service hasn't been created yet.
(DynamicConfigService as any).getCachedInstance = (): DynamicConfigService | null => {
  return _dynamicConfigServiceInstance;
};
