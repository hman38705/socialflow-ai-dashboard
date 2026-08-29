/**
 * Environment configuration and feature flags
 */

export interface EnvConfig {
  VITE_FEATURE_PREDICTIVE: boolean;
  VITE_API_URL: string;
  [key: string]: string | boolean | number | undefined;
}

function getEnvVar(key: string, defaultValue = ''): string {
  if (typeof import.meta !== 'undefined') {
    const metaEnv = (import.meta as { env?: Record<string, string | boolean | undefined> }).env;
    if (metaEnv && metaEnv[key] !== undefined) {
      return String(metaEnv[key]);
    }
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return String(process.env[key]);
  }
  return defaultValue;
}

function parseBooleanEnv(key: string, defaultValue = false): boolean {
  const val = getEnvVar(key, defaultValue ? 'true' : 'false')
    .toLowerCase()
    .trim();
  return val === 'true' || val === '1' || val === 'yes' || val === 'on';
}

export const env: EnvConfig = {
  get VITE_FEATURE_PREDICTIVE() {
    return parseBooleanEnv('VITE_FEATURE_PREDICTIVE', false);
  },
  get VITE_API_URL() {
    return getEnvVar('VITE_API_URL', 'http://localhost:3000');
  },
};

export const isFeatureEnabled = (flagName: 'VITE_FEATURE_PREDICTIVE' | string): boolean => {
  if (flagName === 'VITE_FEATURE_PREDICTIVE' || flagName === 'FEATURE_PREDICTIVE') {
    return env.VITE_FEATURE_PREDICTIVE;
  }
  return parseBooleanEnv(flagName, false);
};
