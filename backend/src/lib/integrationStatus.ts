/**
 * integrationStatus.ts
 *
 * Checks which optional integrations are configured at startup.
 * - Emits a one-time `warn` log for every disabled integration.
 * - Emits a structured startup summary (info) listing enabled/disabled components.
 * - Sets the `app_degraded_capabilities` Prometheus gauge for each component.
 * - Exposes a readiness snapshot consumed by GET /health/readiness.
 * - Throws if REQUIRE_INTEGRATIONS lists an integration that is disabled.
 */
import { config } from '../config/config';
import { createLogger } from './logger';
import { degradedCapabilities } from './metrics';

const logger = createLogger('integration-status');

export interface IntegrationState {
  name: string;
  enabled: boolean;
  reason?: string;
}

/** Definitions of every optional integration and how to detect it. */
const INTEGRATIONS: Array<{ name: string; check: () => boolean; reason: string }> = [
  {
    name: 'youtube',
    check: () => Boolean(config.YOUTUBE_CLIENT_ID && config.YOUTUBE_CLIENT_SECRET),
    reason: 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not set — YouTube sync job will not run',
  },
  {
    name: 'tiktok',
    check: () => Boolean(config.TIKTOK_CLIENT_KEY && config.TIKTOK_CLIENT_SECRET),
    reason: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set — TikTok video worker will not run',
  },
  {
    name: 'facebook',
    check: () => Boolean(config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET),
    reason: 'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET not set — Facebook integration disabled',
  },
  {
    name: 'linkedin',
    check: () => Boolean(config.LINKEDIN_CLIENT_ID && config.LINKEDIN_CLIENT_SECRET),
    reason: 'LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not set — LinkedIn integration disabled',
  },
  {
    name: 'stripe',
    check: () => Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET),
    reason: 'STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set — billing routes will fail',
  },
  {
    name: 'deepl',
    check: () => Boolean(config.DEEPL_API_KEY),
    reason: 'DEEPL_API_KEY not set — DeepL translation unavailable',
  },
  {
    name: 'google-translate',
    check: () => Boolean(config.GOOGLE_TRANSLATE_API_KEY),
    reason: 'GOOGLE_TRANSLATE_API_KEY not set — Google Translate unavailable',
  },
  {
    name: 'elevenlabs',
    check: () => Boolean(config.ELEVENLABS_API_KEY),
    reason: 'ELEVENLABS_API_KEY not set — ElevenLabs TTS unavailable',
  },
  {
    name: 'slack',
    check: () => Boolean(config.SLACK_WEBHOOK_URL),
    reason: 'SLACK_WEBHOOK_URL not set — Slack health alerts disabled',
  },
  {
    name: 'elasticsearch',
    check: () => Boolean(config.ELASTICSEARCH_URL),
    reason: 'ELASTICSEARCH_URL not set — log shipping to Elasticsearch disabled',
  },
  {
    name: 'rate-limit-redis',
    // Evaluated lazily after initRateLimiters() resolves; we import the flag here.
    // In non-production envs the memory store is intentional, so we only flag it
    // as degraded when NODE_ENV === 'production'.
    check: () => {
      if (config.NODE_ENV !== 'production') return true;
      // Avoid a circular import by reading the flag via require at call time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../middleware/rateLimit').rateLimitRedisEnabled === true;
    },
    reason:
      'rate-limit-redis unavailable in production — rate limits are not shared across instances',
  },
];

let _snapshot: IntegrationState[] | null = null;

/**
 * Evaluate all integrations, emit warn logs for disabled ones, enforce
 * REQUIRE_INTEGRATIONS policy, and cache the result for the readiness endpoint.
 *
 * Call once during bootstrap.
 */
export function checkIntegrations(): IntegrationState[] {
  const required = new Set(
    (config.REQUIRE_INTEGRATIONS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const states: IntegrationState[] = INTEGRATIONS.map(({ name, check, reason }) => {
    const enabled = check();
    if (!enabled) {
      logger.warn(`Integration disabled: ${name}`, { reason });
    }
    // Update Prometheus gauge
    degradedCapabilities.labels(name).set(enabled ? 0 : 1);
    return { name, enabled, reason: enabled ? undefined : reason };
  });

  _snapshot = states;

  // Emit structured startup summary
  const enabled = states.filter((s) => s.enabled).map((s) => s.name);
  const disabled = states.filter((s) => !s.enabled).map((s) => s.name);
  logger.info('Optional component startup summary', {
    enabled,
    disabled,
    degradedCount: disabled.length,
  });
  if (disabled.length > 0) {
    logger.warn(
      `${disabled.length} optional component(s) are DISABLED — some production features will not work: ${disabled.join(', ')}`,
    );
  }

  const missing = states.filter((s) => !s.enabled && required.has(s.name));
  if (missing.length > 0) {
    const names = missing.map((s) => s.name).join(', ');
    throw new Error(
      `Required integrations are not configured: ${names}. ` +
        `Set the necessary environment variables or remove them from REQUIRE_INTEGRATIONS.`,
    );
  }

  return states;
}

/** Returns the last computed snapshot (null before checkIntegrations() is called). */
export function getIntegrationSnapshot(): IntegrationState[] | null {
  return _snapshot;
}

/** Reset snapshot — for testing only. */
export const _resetSnapshot = (): void => { _snapshot = null; };
