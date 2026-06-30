import 'reflect-metadata';
import { injectable, inject, optional } from 'inversify';
import { createLogger } from '../lib/logger';
import { DynamicConfigService } from './DynamicConfigService';

const logger = createLogger('alertConfig');

/** DynamicConfig key prefix for per-queue cooldown overrides */
const QUEUE_COOLDOWN_KEY_PREFIX = 'ALERT_COOLDOWN_MS_QUEUE_';

/** DynamicConfig key prefix for persisted service config overrides */
const SERVICE_CONFIG_KEY_PREFIX = 'ALERT_CONFIG_SERVICE_';

export interface AlertThreshold {
  errorRatePercent: number;
  responseTimeMs: number;
  consecutiveFailures: number;
}

export interface ServiceAlertConfig {
  enabled: boolean;
  thresholds: AlertThreshold;
  cooldownMs: number;
}

@injectable()
export class AlertConfigService {
  private configs: Map<string, ServiceAlertConfig> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private dynamicConfig?: DynamicConfigService;

  constructor(@inject('DynamicConfigService') @optional() dynamicConfig?: DynamicConfigService) {
    this.dynamicConfig = dynamicConfig;
    this.initializeDefaults();
    this.loadPersistedOverrides();
  }

  /**
   * Load any previously persisted setConfig overrides from DynamicConfigService
   * so runtime threshold changes survive process restarts.
   */
  private loadPersistedOverrides(): void {
    if (!this.dynamicConfig) return;
    const services = ['database', 'redis', 's3', 'twitter', 'youtube', 'facebook'];
    for (const service of services) {
      const key = `${SERVICE_CONFIG_KEY_PREFIX}${service.toUpperCase()}`;
      const persisted = this.dynamicConfig.get<ServiceAlertConfig | null>(key, null);
      if (persisted !== null) {
        this.configs.set(service, persisted);
        logger.info('Loaded persisted alert config override', { service });
      }
    }
  }

  private initializeDefaults(): void {
    const defaultThresholds: AlertThreshold = {
      errorRatePercent: parseFloat(process.env.ALERT_ERROR_RATE_PERCENT || '10'),
      responseTimeMs: parseInt(process.env.ALERT_RESPONSE_TIME_MS || '5000', 10),
      consecutiveFailures: parseInt(process.env.ALERT_CONSECUTIVE_FAILURES || '3', 10),
    };

    const defaultCooldown = parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10); // 5 minutes

    const services = ['database', 'redis', 's3', 'twitter', 'youtube', 'facebook'];
    services.forEach((service) => {
      this.configs.set(service, {
        enabled: true,
        thresholds: defaultThresholds,
        cooldownMs: defaultCooldown,
      });
    });

    logger.info('Alert configuration initialized', {
      errorRatePercent: defaultThresholds.errorRatePercent,
      responseTimeMs: defaultThresholds.responseTimeMs,
      consecutiveFailures: defaultThresholds.consecutiveFailures,
      cooldownMs: defaultCooldown,
    });
  }

  getConfig(service: string): ServiceAlertConfig | undefined {
    return this.configs.get(service);
  }

  setConfig(service: string, config: ServiceAlertConfig): void {
    this.configs.set(service, config);
    logger.info('Alert configuration updated', { service, config });

    // Persist the override so it survives process restarts.
    if (this.dynamicConfig) {
      const key = `${SERVICE_CONFIG_KEY_PREFIX}${service.toUpperCase()}`;
      this.dynamicConfig.set(key, config, 'json').catch((err) => {
        logger.warn('Failed to persist alert config override', { service, error: (err as Error).message });
      });
    }
  }

  /**
   * Resolves the effective cooldown for a given service/queue name.
   * Checks DynamicConfigService for a per-queue override first, then falls
   * back to the value stored in the service config map.
   *
   * Dynamic config key format: ALERT_COOLDOWN_MS_QUEUE_<QUEUE_NAME_UPPERCASE>
   * Example: ALERT_COOLDOWN_MS_QUEUE_EMAIL  → overrides cooldown for "email" queue
   */
  getCooldown(queueName: string): number {
    const dynamicKey = `${QUEUE_COOLDOWN_KEY_PREFIX}${queueName.toUpperCase()}`;
    if (this.dynamicConfig) {
      const override = this.dynamicConfig.get<number | null>(dynamicKey, null);
      if (override !== null && override > 0) {
        return override;
      }
    }
    return this.configs.get(queueName)?.cooldownMs ?? parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10);
  }

  canAlert(service: string): boolean {
    const lastAlert = this.lastAlertTime.get(service) || 0;
    const timeSinceLastAlert = Date.now() - lastAlert;
    return timeSinceLastAlert >= this.getCooldown(service);
  }

  recordAlert(service: string): void {
    this.lastAlertTime.set(service, Date.now());
  }
}
