/**
 * Typed environment configuration with runtime validation (FE-007).
 *
 * A single, frozen source of truth for every VITE_-prefixed variable this
 * app reads, instead of scattered `import.meta.env.VITE_*` access. Missing
 * required variables throw at module load, listing every offending name at
 * once. Optional variables stay `string | undefined` — never coerced to ''
 * — so a caller can't mistake "unset" for "explicitly empty".
 */

export interface FeatureFlags {
  predictive: boolean;
}

export interface EnvConfig {
  readonly apiBaseUrl: string;
  readonly wsUrl: string;
  readonly sentryDsn: string | undefined;
  readonly stripePublishableKey: string | undefined;
  readonly featureFlags: Readonly<FeatureFlags>;
  readonly mode: string;
}

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === '') return defaultValue;
  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function buildEnvConfig(): EnvConfig {
  const raw = import.meta.env;
  const missing: string[] = [];

  if (!raw.VITE_API_URL) missing.push('VITE_API_URL');
  if (!raw.VITE_WS_URL) missing.push('VITE_WS_URL');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return Object.freeze({
    apiBaseUrl: raw.VITE_API_URL,
    wsUrl: raw.VITE_WS_URL,
    sentryDsn: raw.VITE_SENTRY_DSN || undefined,
    stripePublishableKey: raw.VITE_STRIPE_PUBLISHABLE_KEY || undefined,
    featureFlags: Object.freeze({
      predictive: parseBoolean(raw.VITE_FEATURE_PREDICTIVE),
    }),
    mode: raw.MODE,
  });
}

export const env: EnvConfig = buildEnvConfig();

/**
 * Back-compat wrapper for existing callers (src/features/predictive.ts,
 * FE-098) that check flags by name. New code should read `env.featureFlags`
 * directly.
 */
export function isFeatureEnabled(flagName: string): boolean {
  if (flagName === 'VITE_FEATURE_PREDICTIVE' || flagName === 'FEATURE_PREDICTIVE' || flagName === 'predictive') {
    return env.featureFlags.predictive;
  }
  return false;
}
