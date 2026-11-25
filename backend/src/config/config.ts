import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET_MIN_LENGTH = 32;

const envSchema = z
  .object({
    // ── Server ────────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    // Free-form deployment label for dashboards/telemetry; defaults to NODE_ENV.
    APP_ENV: z.string().optional(),
    BACKEND_PORT: z.coerce.number().int().positive().default(3001),
    CORS_ALLOWED_ORIGINS: z.string().optional(),

    // ── Database ──────────────────────────────────────────────────────────────
    // DATABASE_URL can be provided directly (local/test) or assembled at
    // runtime from discrete DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD values
    // (production — see infra), so the DB password is never stored as part of
    // one combined Terraform-tracked SSM parameter.
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').optional(),
    DB_HOST: z.string().optional(),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().optional(),
    DB_USER: z.string().optional(),
    DB_PASSWORD: z.string().optional(),
    DATABASE_REPLICA_URL: z.string().url('DATABASE_REPLICA_URL must be a valid URL').optional(),
    // Connection pool — defaults tuned per environment in src/lib/prisma.ts
    // Override here to hard-pin values regardless of NODE_ENV.
    DB_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
    DB_POOL_TIMEOUT: z.coerce.number().int().positive().optional(),
    // Set to 'true' when a PgBouncer proxy sits in front of Postgres.
    // In transaction mode, PgBouncer requires connection_limit=1 per application process.
    PGBOUNCER_MODE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),

    // ── JWT ───────────────────────────────────────────────────────────────────
    JWT_SECRET: z
      .string()
      .min(
        JWT_SECRET_MIN_LENGTH,
        `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
      ),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(
        JWT_SECRET_MIN_LENGTH,
        `JWT_REFRESH_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
      ),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    // ── CSRF ──────────────────────────────────────────────────────────────────
    CSRF_SECRET: z
      .string()
      .min(
        JWT_SECRET_MIN_LENGTH,
        `CSRF_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters`,
      ),

    // ── Redis ─────────────────────────────────────────────────────────────────
    // Optional single-URL form (e.g. rediss://user:pass@host:port). When set,
    // it takes precedence over the individual REDIS_HOST/PORT/PASSWORD fields.
    REDIS_URL: z.string().url('REDIS_URL must be a valid URL').optional(),
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
    // Enabling the Twitter webhook requires TWITTER_WEBHOOK_SECRET (enforced in superRefine).
    TWITTER_WEBHOOK_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((v) => v === 'true' || v === '1')
      .default(false),
    TWITTER_WEBHOOK_SECRET: z.string().optional(),

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
    // STRIPE_SECRET_KEY enables billing. When it is set, STRIPE_WEBHOOK_SECRET
    // is also required (enforced in superRefine below) so the app fails at
    // startup rather than on the first webhook delivery.
    STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_STARTER: z.string().optional(),
    STRIPE_PRICE_PRO: z.string().optional(),
    STRIPE_PRICE_ENTERPRISE: z.string().optional(),

    // ── Observability ─────────────────────────────────────────────────────────
    OTEL_SERVICE_NAME: z
      .string()
      .min(1, 'OTEL_SERVICE_NAME is required')
      .default('socialflow-backend'),
    OTEL_EXPORTER: z.enum(['jaeger', 'honeycomb', 'otlp']).default('jaeger'),
    JAEGER_ENDPOINT: z
      .string()
      .url('JAEGER_ENDPOINT must be a valid URL')
      .default('http://localhost:14268/api/traces'),
    HONEYCOMB_API_KEY: z.string().optional(),
    HONEYCOMB_DATASET: z.string().default('socialflow-ai-dashboard'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .string()
      .url('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL')
      .default('http://localhost:4318/v1/traces'),
    OTEL_DEBUG: z
      .string()
      .optional()
      .transform((v) => v === 'true'),

    ELASTICSEARCH_URL: z.string().url('ELASTICSEARCH_URL must be a valid URL').optional(),
    ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
    LOG_LEVEL: z
      .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
      .default('info'),

    // ── Alerting ──────────────────────────────────────────────────────────────
    SLACK_WEBHOOK_URL: z
      .string()
      .optional()
      .refine(
        (url) => !url || url.startsWith('https://hooks.slack.com/'),
        'SLACK_WEBHOOK_URL must start with https://hooks.slack.com/',
      ),
    PAGERDUTY_INTEGRATION_KEY: z.string().optional(),

    // ── SMS (Twilio) ──────────────────────────────────────────────────────────
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    ALERT_ERROR_RATE_PERCENT: z.coerce.number().default(10),
    ALERT_RESPONSE_TIME_MS: z.coerce.number().default(5000),
    ALERT_CONSECUTIVE_FAILURES: z.coerce.number().int().default(3),
    ALERT_COOLDOWN_MS: z.coerce.number().default(300000),
    HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(300000),

    // ── Data Retention ────────────────────────────────────────────────────────
    DATA_PRUNING_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((v) => v === 'true' || v === '1')
      .default(false),
    DATA_PRUNING_DRY_RUN: z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((v) => v === 'true' || v === '1')
      .default(false),
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
    // OpenAI key used by ModerationService. Optional: when unset, moderation
    // falls back to the configured MODERATION_MODE behaviour.
    OPENAI_API_KEY: z.string().optional(),
    // fail-closed (default): block content when provider is unavailable — safer for production.
    // fail-open: allow content through when provider is unavailable — requires explicit opt-in.
    MODERATION_MODE: z.enum(['fail-open', 'fail-closed']).default('fail-closed'),
    // Threshold preset: low (permissive), medium (default), high (strict).
    MODERATION_SENSITIVITY: z.enum(['low', 'medium', 'high']).default('medium'),
    // Comma-separated list of additional terms that are always blocked.
    MODERATION_ALWAYS_BLOCK_EXTRA: z.string().default(''),

    // ── AWS S3 ────────────────────────────────────────────────────────────────
    S3_PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3600),

    // ── SSE Tickets ───────────────────────────────────────────────────────────
    // Maximum number of live SSE tickets held in-process. When the cap is
    // reached, the oldest tickets are evicted so a client looping the ticket
    // endpoint cannot grow the map without bound.
    SSE_TICKET_MAX: z.coerce.number().int().positive().default(10000),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && data.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED === 'false') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED'],
        message:
          'ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED cannot be "false" in production — disabling TLS verification exposes Elasticsearch traffic to MITM attacks',
      });
    }

    if (!data.DATABASE_URL && !(data.DB_HOST && data.DB_NAME && data.DB_USER && data.DB_PASSWORD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message:
          'Either DATABASE_URL or the full set of DB_HOST/DB_NAME/DB_USER/DB_PASSWORD must be set',
      });
    }

    // Billing is enabled whenever STRIPE_SECRET_KEY is set (it is required).
    // Webhook handling needs the signing secret, so require it up front rather
    // than throwing on the first webhook delivery.
    if (data.TWITTER_WEBHOOK_ENABLED && !data.TWITTER_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWITTER_WEBHOOK_SECRET'],
        message:
          'TWITTER_WEBHOOK_SECRET is required when the Twitter webhook is enabled (TWITTER_WEBHOOK_ENABLED=true)',
      });
    }

    if (data.STRIPE_SECRET_KEY && !data.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_WEBHOOK_SECRET'],
        message:
          'STRIPE_WEBHOOK_SECRET is required when billing is enabled (STRIPE_SECRET_KEY is set)',
      });
    }
  });

/**
 * Builds the Postgres connection string at runtime. Prefers an explicit
 * DATABASE_URL (local/test); otherwise assembles it from discrete
 * DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD values, which is how
 * production is configured — see terraform/modules/ecs, which injects these
 * as separate SSM parameters instead of one pre-assembled connection string
 * so the password is never stored as part of a single combined attribute.
 */
function buildDatabaseUrl(data: Env): string {
  if (data.DATABASE_URL) return data.DATABASE_URL;
  const user = encodeURIComponent(data.DB_USER!);
  const password = encodeURIComponent(data.DB_PASSWORD!);
  return `postgresql://${user}:${password}@${data.DB_HOST}:${data.DB_PORT}/${data.DB_NAME}`;
}

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
    console.log(
      `[Telemetry Diagnostics] OTEL_EXPORTER_OTLP_ENDPOINT=${result.data.OTEL_EXPORTER_OTLP_ENDPOINT}`,
    );
  } else if (result.data.OTEL_EXPORTER === 'honeycomb') {
    console.log(`[Telemetry Diagnostics] HONEYCOMB_DATASET=${result.data.HONEYCOMB_DATASET}`);
  }
  console.log(`[Telemetry Diagnostics] OTEL_SERVICE_NAME=${result.data.OTEL_SERVICE_NAME}`);
  console.log(`[Telemetry Diagnostics] OTEL_DEBUG=${result.data.OTEL_DEBUG}`);
  console.log(`[Telemetry Diagnostics] LOG_LEVEL=${result.data.LOG_LEVEL}`);

  // Warn if Slack webhook is not configured
  if (!result.data.SLACK_WEBHOOK_URL) {
    console.warn(
      '[Startup Warning] SLACK_WEBHOOK_URL is not set — health alerts will not be sent to Slack',
    );
  }

  // Warn if no TTS provider is configured
  if (!result.data.ELEVENLABS_API_KEY && !result.data.GOOGLE_TTS_API_KEY) {
    console.warn('[Startup Warning] No TTS provider configured — TTS features will be unavailable');
  }

  // Assemble DATABASE_URL from discrete parts when it wasn't provided
  // directly, and keep process.env.DATABASE_URL in sync for code paths
  // (e.g. Prisma) that read it straight from the environment.
  const databaseUrl = buildDatabaseUrl(result.data);
  process.env.DATABASE_URL = databaseUrl;

  return { ...result.data, DATABASE_URL: databaseUrl };
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

/** True for environments that must use strict (non-debug, non-wildcard) behaviour. */
export const isProductionLike = (env: Env['NODE_ENV']): boolean =>
  env === 'production' || env === 'staging';

export { validateEnv };
