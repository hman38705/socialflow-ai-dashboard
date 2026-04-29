import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // ── Server ────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DATABASE_REPLICA_URL: z.string().url('DATABASE_REPLICA_URL must be a valid URL').optional(),
  // Connection pool — defaults tuned per environment in src/lib/prisma.ts
  // Override here to hard-pin values regardless of NODE_ENV.
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
  DB_POOL_TIMEOUT: z.coerce.number().int().positive().optional(),

  // ── JWT ───────────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  // Set to 'true' in production when ElastiCache transit encryption is enabled (rediss://)
  REDIS_TLS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // ── Social APIs ───────────────────────────────────────────────────────────
  TWITTER_API_KEY: z.string().min(1, 'TWITTER_API_KEY is required'),
  TWITTER_API_SECRET: z.string().min(1, 'TWITTER_API_SECRET is required'),

  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: z.string().optional(),

  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().optional(),

  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().optional(),

  INSTAGRAM_REDIRECT_URI: z.string().optional(),

  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.string().optional(),

  // ── AI / Translation ──────────────────────────────────────────────────────
  DEEPL_API_KEY: z.string().optional(),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  GOOGLE_TTS_API_KEY: z.string().optional(),

  // ── Billing ───────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ── Observability ─────────────────────────────────────────────────────────
  OTEL_SERVICE_NAME: z.string().min(1, 'OTEL_SERVICE_NAME is required').default('socialflow-backend'),
  OTEL_EXPORTER: z.enum(['jaeger', 'honeycomb', 'otlp']).default('jaeger'),
  JAEGER_ENDPOINT: z.string().url('JAEGER_ENDPOINT must be a valid URL').default('http://localhost:14268/api/traces'),
  HONEYCOMB_API_KEY: z.string().optional(),
  HONEYCOMB_DATASET: z.string().default('socialflow-ai-dashboard'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL').default('http://localhost:4318/v1/traces'),
  OTEL_DEBUG: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  ELASTICSEARCH_URL: z.string().url('ELASTICSEARCH_URL must be a valid URL').optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),

  // ── Alerting ──────────────────────────────────────────────────────────────
  SLACK_WEBHOOK_URL: z.string().optional(),
  PAGERDUTY_INTEGRATION_KEY: z.string().optional(),
  ALERT_ERROR_RATE_PERCENT: z.coerce.number().default(10),
  ALERT_RESPONSE_TIME_MS: z.coerce.number().default(5000),
  ALERT_CONSECUTIVE_FAILURES: z.coerce.number().int().default(3),
  ALERT_COOLDOWN_MS: z.coerce.number().default(300000),
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(300000),

  // ── Data Retention ────────────────────────────────────────────────────────
  DATA_PRUNING_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v !== 'false' && v !== '0')
    .default(true),
  DATA_RETENTION_MODE: z.enum(['archive', 'delete']).default('archive'),
  DATA_RETENTION_ARCHIVE_DIR: z.string().default('cold-storage'),
  DATA_PRUNING_CRON: z.string().default('0 2 * * *'),
  DATA_RETENTION_LOG_DAYS: z.coerce.number().int().positive().default(30),
  DATA_RETENTION_ANALYTICS_DAYS: z.coerce.number().int().positive().default(90),
  DATA_RETENTION_MISSING_PATH_POLICY: z.enum(['warn', 'fail', 'ignore']).default('warn'),
  DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD: z.coerce.number().int().nonnegative().default(3),

  // ── Worker Monitor ────────────────────────────────────────────────────────
  WORKER_MONITOR_INTERVAL_MS: z.coerce.number().default(30000),
  WORKER_MONITOR_LATENCY_THRESHOLD_MS: z.coerce.number().default(60000),
  WORKER_MONITOR_STUCK_THRESHOLD_MS: z.coerce.number().default(300000),
  WORKER_MONITOR_QUEUES: z.string().default(''),

  // ── YouTube Sync ──────────────────────────────────────────────────────────
  YOUTUBE_SYNC_CRON: z.string().default('0 */6 * * *'),

  // ── Required integrations policy ─────────────────────────────────────────
  // Comma-separated list of integration names that must be configured.
  // If any listed integration is disabled, startup fails.
  // Example: REQUIRE_INTEGRATIONS=youtube,tiktok,stripe
  REQUIRE_INTEGRATIONS: z.string().optional(),

  // ── Webhooks ──────────────────────────────────────────────────────────────
  HMAC_TIMESTAMP_TOLERANCE_MS: z.coerce.number().default(300000),

  // ── Dynamic Config ────────────────────────────────────────────────────────
  DYNAMIC_CONFIG_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_STORE: z.enum(['redis', 'memory']).default('redis'),

  // ── Meilisearch ───────────────────────────────────────────────────────────
  MEILISEARCH_HOST: z.string().default('http://localhost:7700'),
  MEILISEARCH_ADMIN_KEY: z.string().optional(),
  MEILISEARCH_SEARCH_KEY: z.string().optional(),

  // ── Moderation ────────────────────────────────────────────────────────────
  // fail-closed (default): block content when provider is unavailable — safer for production.
  // fail-open: allow content through when provider is unavailable — requires explicit opt-in.
  MODERATION_MODE: z.enum(['fail-open', 'fail-closed']).default('fail-closed'),
  MODERATION_SENSITIVITY: z.enum(['low', 'medium', 'high']).default('medium'),

  // ── AWS S3 ────────────────────────────────────────────────────────────────
  S3_PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process.env against the schema and returns a typed config object.
 * Throws a descriptive error listing all validation failures if any required
 * variables are missing or have the wrong type.
 */
function validateEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  // Emit startup diagnostics for telemetry configuration
  console.log(`[Telemetry Diagnostics] OTEL_EXPORTER=${result.data.OTEL_EXPORTER}`);
  if (result.data.OTEL_EXPORTER === 'jaeger') {
    console.log(`[Telemetry Diagnostics] JAEGER_ENDPOINT=${result.data.JAEGER_ENDPOINT}`);
  } else if (result.data.OTEL_EXPORTER === 'otlp') {
    console.log(`[Telemetry Diagnostics] OTEL_EXPORTER_OTLP_ENDPOINT=${result.data.OTEL_EXPORTER_OTLP_ENDPOINT}`);
  } else if (result.data.OTEL_EXPORTER === 'honeycomb') {
    console.log(`[Telemetry Diagnostics] HONEYCOMB_DATASET=${result.data.HONEYCOMB_DATASET}`);
  }
  console.log(`[Telemetry Diagnostics] OTEL_SERVICE_NAME=${result.data.OTEL_SERVICE_NAME}`);
  console.log(`[Telemetry Diagnostics] OTEL_DEBUG=${result.data.OTEL_DEBUG}`);
  console.log(`[Telemetry Diagnostics] LOG_LEVEL=${result.data.LOG_LEVEL}`);

  return result.data;
}

// Lazily validated so test files can import `validateEnv` without a valid
// process.env. The singleton is initialised on first access.
let _config: Env | undefined;
export const config = new Proxy({} as Env, {
  get(_target, prop) {
    if (!_config) _config = validateEnv();
    return (_config as Record<string | symbol, unknown>)[prop];
  },
});

export { validateEnv };
