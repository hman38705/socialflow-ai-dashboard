/**
 * Unit tests for AlertConfigService
 *
 * Covers:
 *  1. Per-service thresholds — default values, custom env vars, setConfig override
 *  2. Cooldown gate — canAlert, recordAlert timing, per-service isolation
 *  3. DynamicConfig override — getCooldown reads ALERT_COOLDOWN_MS_QUEUE_* key
 */

import 'reflect-metadata';
import { AlertConfigService } from '../alertConfigService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DynamicConfigService mock */
function makeDynamicConfig(overrides: Record<string, number | null> = {}) {
  return {
    get: jest.fn(<T>(key: string, defaultValue: T): T => {
      if (key in overrides) return overrides[key] as unknown as T;
      return defaultValue;
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. Per-service thresholds
// ---------------------------------------------------------------------------

describe('AlertConfigService — per-service thresholds', () => {
  const KNOWN_SERVICES = ['database', 'redis', 's3', 'twitter', 'youtube', 'facebook'];

  it('initializes a config entry for every default service', () => {
    const svc = new AlertConfigService();
    for (const name of KNOWN_SERVICES) {
      expect(svc.getConfig(name)).toBeDefined();
    }
  });

  it('default config has enabled: true for all services', () => {
    const svc = new AlertConfigService();
    for (const name of KNOWN_SERVICES) {
      expect(svc.getConfig(name)?.enabled).toBe(true);
    }
  });

  it('returns undefined for an unknown service name', () => {
    const svc = new AlertConfigService();
    expect(svc.getConfig('unknown-service')).toBeUndefined();
  });

  it('uses ALERT_ERROR_RATE_PERCENT env var for errorRatePercent threshold', () => {
    process.env.ALERT_ERROR_RATE_PERCENT = '25';
    const svc = new AlertConfigService();
    delete process.env.ALERT_ERROR_RATE_PERCENT;

    const cfg = svc.getConfig('database');
    expect(cfg?.thresholds.errorRatePercent).toBe(25);
  });

  it('uses ALERT_RESPONSE_TIME_MS env var for responseTimeMs threshold', () => {
    process.env.ALERT_RESPONSE_TIME_MS = '8000';
    const svc = new AlertConfigService();
    delete process.env.ALERT_RESPONSE_TIME_MS;

    const cfg = svc.getConfig('redis');
    expect(cfg?.thresholds.responseTimeMs).toBe(8000);
  });

  it('uses ALERT_CONSECUTIVE_FAILURES env var for consecutiveFailures threshold', () => {
    process.env.ALERT_CONSECUTIVE_FAILURES = '7';
    const svc = new AlertConfigService();
    delete process.env.ALERT_CONSECUTIVE_FAILURES;

    const cfg = svc.getConfig('twitter');
    expect(cfg?.thresholds.consecutiveFailures).toBe(7);
  });

  it('defaults to errorRatePercent=10 when env var is absent', () => {
    const savedVal = process.env.ALERT_ERROR_RATE_PERCENT;
    delete process.env.ALERT_ERROR_RATE_PERCENT;
    const svc = new AlertConfigService();
    if (savedVal !== undefined) process.env.ALERT_ERROR_RATE_PERCENT = savedVal;

    expect(svc.getConfig('database')?.thresholds.errorRatePercent).toBe(10);
  });

  it('defaults to responseTimeMs=5000 when env var is absent', () => {
    const savedVal = process.env.ALERT_RESPONSE_TIME_MS;
    delete process.env.ALERT_RESPONSE_TIME_MS;
    const svc = new AlertConfigService();
    if (savedVal !== undefined) process.env.ALERT_RESPONSE_TIME_MS = savedVal;

    expect(svc.getConfig('database')?.thresholds.responseTimeMs).toBe(5000);
  });

  it('defaults to consecutiveFailures=3 when env var is absent', () => {
    const savedVal = process.env.ALERT_CONSECUTIVE_FAILURES;
    delete process.env.ALERT_CONSECUTIVE_FAILURES;
    const svc = new AlertConfigService();
    if (savedVal !== undefined) process.env.ALERT_CONSECUTIVE_FAILURES = savedVal;

    expect(svc.getConfig('database')?.thresholds.consecutiveFailures).toBe(3);
  });


  it('setConfig replaces the config for an existing service', () => {
    const svc = new AlertConfigService();
    const custom = {
      enabled: false,
      thresholds: { errorRatePercent: 50, responseTimeMs: 1000, consecutiveFailures: 1 },
      cooldownMs: 60000,
    };
    svc.setConfig('database', custom);
    expect(svc.getConfig('database')).toEqual(custom);
  });

  it('setConfig can add a config for a new service not in the defaults', () => {
    const svc = new AlertConfigService();
    const cfg = {
      enabled: true,
      thresholds: { errorRatePercent: 5, responseTimeMs: 2000, consecutiveFailures: 2 },
      cooldownMs: 120000,
    };
    svc.setConfig('custom-service', cfg);
    expect(svc.getConfig('custom-service')).toEqual(cfg);
  });

  it('setConfig with enabled:false disables alerting for that service', () => {
    const svc = new AlertConfigService();
    svc.setConfig('s3', {
      enabled: false,
      thresholds: { errorRatePercent: 10, responseTimeMs: 5000, consecutiveFailures: 3 },
      cooldownMs: 300000,
    });
    expect(svc.getConfig('s3')?.enabled).toBe(false);
  });

  it('each service gets the same shared default thresholds object values', () => {
    const svc = new AlertConfigService();
    const db = svc.getConfig('database')?.thresholds;
    const redis = svc.getConfig('redis')?.thresholds;
    expect(db).toEqual(redis);
  });
});

// ---------------------------------------------------------------------------
// 2. Cooldown gate — canAlert / recordAlert
// ---------------------------------------------------------------------------

describe('AlertConfigService — cooldown gate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('canAlert returns true before any alert has been recorded', () => {
    const svc = new AlertConfigService();
    expect(svc.canAlert('database')).toBe(true);
  });

  it('canAlert returns false immediately after recordAlert', () => {
    const svc = new AlertConfigService();
    svc.recordAlert('database');
    expect(svc.canAlert('database')).toBe(false);
  });

  it('canAlert returns true once the cooldown period has elapsed', () => {
    process.env.ALERT_COOLDOWN_MS = '300000'; // 5 min
    const svc = new AlertConfigService();
    delete process.env.ALERT_COOLDOWN_MS;

    svc.recordAlert('database');
    expect(svc.canAlert('database')).toBe(false);

    jest.advanceTimersByTime(300000);
    expect(svc.canAlert('database')).toBe(true);
  });

  it('canAlert returns false one millisecond before cooldown expires', () => {
    process.env.ALERT_COOLDOWN_MS = '60000';
    const svc = new AlertConfigService();
    delete process.env.ALERT_COOLDOWN_MS;

    svc.recordAlert('redis');
    jest.advanceTimersByTime(59999);
    expect(svc.canAlert('redis')).toBe(false);
  });

  it('cooldown is independent per service', () => {
    const svc = new AlertConfigService();
    svc.recordAlert('database');

    // redis has NOT been alerted — should still be alertable
    expect(svc.canAlert('redis')).toBe(true);
    // database was just alerted — should be blocked
    expect(svc.canAlert('database')).toBe(false);
  });

  it('multiple recordAlert calls reset the cooldown timer', () => {
    process.env.ALERT_COOLDOWN_MS = '60000';
    const svc = new AlertConfigService();
    delete process.env.ALERT_COOLDOWN_MS;

    svc.recordAlert('twitter');
    jest.advanceTimersByTime(59000); // almost expired

    svc.recordAlert('twitter'); // reset
    jest.advanceTimersByTime(2000); // only 2 s after reset
    // Should still be blocked because timer was just reset
    expect(svc.canAlert('twitter')).toBe(false);
  });

  it('canAlert returns true for an unknown service (no cooldown history)', () => {
    const svc = new AlertConfigService();
    expect(svc.canAlert('nonexistent-service')).toBe(true);
  });

  it('default cooldown is 300000ms when ALERT_COOLDOWN_MS is not set', () => {
    const savedVal = process.env.ALERT_COOLDOWN_MS;
    delete process.env.ALERT_COOLDOWN_MS;
    const svc = new AlertConfigService();
    if (savedVal !== undefined) process.env.ALERT_COOLDOWN_MS = savedVal;

    svc.recordAlert('facebook');
    jest.advanceTimersByTime(299999);
    expect(svc.canAlert('facebook')).toBe(false);

    jest.advanceTimersByTime(1);
    expect(svc.canAlert('facebook')).toBe(true);
  });

  it('uses ALERT_COOLDOWN_MS env var as the default cooldown', () => {
    process.env.ALERT_COOLDOWN_MS = '10000'; // 10 s
    const svc = new AlertConfigService();
    delete process.env.ALERT_COOLDOWN_MS;

    svc.recordAlert('youtube');
    jest.advanceTimersByTime(10000);
    expect(svc.canAlert('youtube')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. DynamicConfig override — getCooldown
// ---------------------------------------------------------------------------

describe('AlertConfigService — DynamicConfig override for getCooldown', () => {
  it('returns the static cooldownMs when no DynamicConfig is injected', () => {
    const svc = new AlertConfigService();
    // 'database' has the default cooldown from env (300000ms in test)
    const cooldown = svc.getCooldown('database');
    expect(typeof cooldown).toBe('number');
    expect(cooldown).toBeGreaterThan(0);
  });

  it('returns the DynamicConfig override when key is present and > 0', () => {
    const dynCfg = makeDynamicConfig({ ALERT_COOLDOWN_MS_QUEUE_EMAIL: 12000 });
    const svc = new AlertConfigService(dynCfg as any);
    expect(svc.getCooldown('email')).toBe(12000);
  });

  it('falls back to static cooldown when DynamicConfig returns null', () => {
    const dynCfg = makeDynamicConfig({ ALERT_COOLDOWN_MS_QUEUE_DATABASE: null });
    const svc = new AlertConfigService(dynCfg as any);

    // Static cooldown for 'database' should be the env-derived value
    const staticCooldown = svc.getConfig('database')?.cooldownMs ?? 300000;
    expect(svc.getCooldown('database')).toBe(staticCooldown);
  });

  it('falls back to static cooldown when DynamicConfig returns 0 (invalid)', () => {
    const dynCfg = makeDynamicConfig({ ALERT_COOLDOWN_MS_QUEUE_REDIS: 0 });
    const svc = new AlertConfigService(dynCfg as any);

    const staticCooldown = svc.getConfig('redis')?.cooldownMs ?? 300000;
    expect(svc.getCooldown('redis')).toBe(staticCooldown);
  });

  it('uses uppercase queue name as the DynamicConfig key', () => {
    const dynCfg = makeDynamicConfig();
    const svc = new AlertConfigService(dynCfg as any);
    svc.getCooldown('email');

    expect(dynCfg.get).toHaveBeenCalledWith('ALERT_COOLDOWN_MS_QUEUE_EMAIL', null);
  });

  it('key format is ALERT_COOLDOWN_MS_QUEUE_<NAME_UPPERCASE>', () => {
    const dynCfg = makeDynamicConfig();
    const svc = new AlertConfigService(dynCfg as any);

    svc.getCooldown('myQueue');
    expect(dynCfg.get).toHaveBeenCalledWith('ALERT_COOLDOWN_MS_QUEUE_MYQUEUE', null);
  });

  it('DynamicConfig override affects canAlert cooldown check', () => {
    jest.useFakeTimers();
    // Override cooldown for 'email' to 5000ms
    const dynCfg = makeDynamicConfig({ ALERT_COOLDOWN_MS_QUEUE_EMAIL: 5000 });
    const svc = new AlertConfigService(dynCfg as any);

    svc.recordAlert('email');
    expect(svc.canAlert('email')).toBe(false);

    jest.advanceTimersByTime(5000);
    expect(svc.canAlert('email')).toBe(true);
    jest.useRealTimers();
  });

  it('DynamicConfig override does not affect a different queue', () => {
    const dynCfg = makeDynamicConfig({ ALERT_COOLDOWN_MS_QUEUE_EMAIL: 5000 });
    const svc = new AlertConfigService(dynCfg as any);

    // twitter uses static default, not the email override
    const twitterCooldown = svc.getCooldown('twitter');
    const staticCooldown = svc.getConfig('twitter')?.cooldownMs ?? 300000;
    expect(twitterCooldown).toBe(staticCooldown);
  });

  it('falls back to ALERT_COOLDOWN_MS env for unknown service with no DynamicConfig', () => {
    process.env.ALERT_COOLDOWN_MS = '45000';
    const svc = new AlertConfigService();
    delete process.env.ALERT_COOLDOWN_MS;

    // 'ghost-queue' has no config entry; falls back to env parse
    expect(svc.getCooldown('ghost-queue')).toBe(45000);
  });
});
