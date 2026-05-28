import { RedisOptions } from 'ioredis';
import { config } from '../config/config';

export const getNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getBackendPort = (): number => config.BACKEND_PORT;

export const getRedisConnection = (): RedisOptions => ({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  db: config.REDIS_DB,
  maxRetriesPerRequest: null,
  // Enable TLS when REDIS_TLS=true (required for ElastiCache with transit encryption)
  tls: config.REDIS_TLS ? {} : undefined,
});

export const getConfiguredQueueNames = (): string[] =>
  config.WORKER_MONITOR_QUEUES.split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export const getBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parsePathList = (value: string | undefined, fallback: string[]): string[] => {
  const source = value ?? fallback.join(',');
  return source
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export interface DataRetentionConfig {
  enabled: boolean;
  dryRun: boolean;
  mode: 'archive' | 'delete';
  archiveDirectory: string;
  scheduleCron: string;
  logsRetentionDays: number;
  analyticsRetentionDays: number;
  logsPaths: string[];
  analyticsPaths: string[];
  queueName: string;
  missingPathPolicy: 'warn' | 'fail' | 'ignore';
  missingPathAlertThreshold: number;
}

export const getAdminIpWhitelist = (): string[] =>
  (process.env.ADMIN_IP_WHITELIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const getDataRetentionConfig = (): DataRetentionConfig => ({
  enabled: config.DATA_PRUNING_ENABLED,
  dryRun: config.DATA_PRUNING_DRY_RUN,
  mode: config.DATA_RETENTION_MODE,
  archiveDirectory: config.DATA_RETENTION_ARCHIVE_DIR,
  scheduleCron: config.DATA_PRUNING_CRON,
  logsRetentionDays: config.DATA_RETENTION_LOG_DAYS,
  analyticsRetentionDays: config.DATA_RETENTION_ANALYTICS_DAYS,
  logsPaths: parsePathList(process.env.DATA_RETENTION_LOG_PATHS, ['logs']),
  analyticsPaths: parsePathList(process.env.DATA_RETENTION_ANALYTICS_PATHS, ['data/analytics']),
  queueName: process.env.DATA_PRUNING_QUEUE ?? 'data-pruning',
  missingPathPolicy: config.DATA_RETENTION_MISSING_PATH_POLICY,
  missingPathAlertThreshold: config.DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD,
});
