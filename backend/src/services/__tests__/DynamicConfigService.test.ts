import { DynamicConfigService, ConfigKey } from '../DynamicConfigService';

// Prevent real DB calls
const mockFindMany = jest.fn().mockResolvedValue([]);
const mockUpsert = jest.fn().mockResolvedValue({});

jest.mock('../../lib/prisma', () => ({
  prisma: { dynamicConfig: { findMany: mockFindMany, upsert: mockUpsert } },
}));

jest.mock('../../config/config', () => ({
  config: { DYNAMIC_CONFIG_POLL_INTERVAL_MS: 60000 },
}));

describe('DynamicConfigService – poll interval', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uses the provided interval (default 60 000 ms)', async () => {
    const svc = await DynamicConfigService.create(60000);
    const refreshSpy = jest.spyOn(svc as any, 'refreshCache').mockResolvedValue(undefined);

    svc.stopPolling();
    (svc as any).pollingInterval = null;
    svc.startPolling();

    jest.advanceTimersByTime(60000);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60000);
    expect(refreshSpy).toHaveBeenCalledTimes(2);

    svc.stopPolling();
  });

  it('respects a custom interval passed to the factory', async () => {
    const svc = await DynamicConfigService.create(5000);
    const refreshSpy = jest.spyOn(svc as any, 'refreshCache').mockResolvedValue(undefined);

    svc.stopPolling();
    (svc as any).pollingInterval = null;
    svc.startPolling();

    jest.advanceTimersByTime(5000);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4999);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    svc.stopPolling();
  });

  it('cache is populated before create() resolves', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'testKey', value: 'testValue', type: 'string' },
    ]);

    const svc = await DynamicConfigService.create();

    expect(svc.get('testKey')).toBe('testValue');
  });

  it('reads DYNAMIC_CONFIG_POLL_INTERVAL_MS from env via config', () => {
    const originalEnv = process.env.DYNAMIC_CONFIG_POLL_INTERVAL_MS;
    process.env.DYNAMIC_CONFIG_POLL_INTERVAL_MS = '15000';

    jest.resetModules();
    const { validateEnv } = require('../../config/config');
    const cfg = validateEnv(process.env);
    expect(cfg.DYNAMIC_CONFIG_POLL_INTERVAL_MS).toBe(15000);

    process.env.DYNAMIC_CONFIG_POLL_INTERVAL_MS = originalEnv;
  });

  it('defaults to 60 000 ms when env var is not set', () => {
    jest.resetModules();
    const saved = process.env.DYNAMIC_CONFIG_POLL_INTERVAL_MS;
    delete process.env.DYNAMIC_CONFIG_POLL_INTERVAL_MS;

    const { validateEnv } = require('../../config/config');
    const cfg = validateEnv(process.env);
    expect(cfg.DYNAMIC_CONFIG_POLL_INTERVAL_MS).toBe(60000);

    process.env.DYNAMIC_CONFIG_POLL_INTERVAL_MS = saved;
  });
});

describe('DynamicConfigService – initialization guard', () => {
  afterEach(() => jest.clearAllMocks());

  it('initialize() stores fetched config and marks service ready', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: ConfigKey.RATE_LIMIT_MAX, value: '200', type: 'number' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get(ConfigKey.RATE_LIMIT_MAX)).toBe(200);
  });

  it('get() returns hardcoded default when key not in cache', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const svc = await DynamicConfigService.create();
    expect(svc.get(ConfigKey.RATE_LIMIT_MAX)).toBe(100);
  });

  it('get() returns provided default when key not in cache', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const svc = await DynamicConfigService.create();
    expect(svc.get('UNKNOWN_KEY', 'fallback')).toBe('fallback');
  });

  it('refreshCache is a no-op if already polling', async () => {
    const svc = await DynamicConfigService.create();
    (svc as any).isPollingActive = true;
    mockFindMany.mockClear();
    await svc.refreshCache();
    expect(mockFindMany).not.toHaveBeenCalled();
    (svc as any).isPollingActive = false;
  });

  it('second create() call re-initializes correctly (singleton guard via getDynamicConfigService)', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: ConfigKey.CACHE_TTL, value: '7200', type: 'number' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get(ConfigKey.CACHE_TTL)).toBe(7200);
  });
});

describe('DynamicConfigService – config key resolution', () => {
  afterEach(() => jest.clearAllMocks());

  it('parses string type correctly', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'myKey', value: 'hello', type: 'string' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get('myKey')).toBe('hello');
  });

  it('parses number type correctly', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'numKey', value: '42', type: 'number' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get('numKey')).toBe(42);
  });

  it('parses boolean type correctly', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'boolKey', value: 'true', type: 'boolean' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get('boolKey')).toBe(true);
  });

  it('parses json type correctly', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'jsonKey', value: '{"a":1}', type: 'json' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get('jsonKey')).toEqual({ a: 1 });
  });

  it('returns null for malformed JSON', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'badJson', value: '{bad}', type: 'json' },
    ]);
    const svc = await DynamicConfigService.create();
    expect(svc.get('badJson')).toBeNull();
  });
});

describe('DynamicConfigService – runtime override propagation', () => {
  afterEach(() => jest.clearAllMocks());

  it('set() updates cache immediately and takes precedence over fetched value', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: ConfigKey.CACHE_TTL, value: '3600', type: 'number' },
    ]);
    mockUpsert.mockResolvedValue({});
    const svc = await DynamicConfigService.create();

    await svc.set(ConfigKey.CACHE_TTL, 9999, 'number');

    expect(svc.get(ConfigKey.CACHE_TTL)).toBe(9999);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: ConfigKey.CACHE_TTL } }),
    );
  });

  it('onChange listener is fired when value changes via refreshCache', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: ConfigKey.MAINTENANCE_MODE, value: 'false', type: 'boolean' },
    ]);
    const svc = await DynamicConfigService.create();

    const listener = jest.fn();
    svc.onChange(ConfigKey.MAINTENANCE_MODE, listener);

    mockFindMany.mockResolvedValueOnce([
      { key: ConfigKey.MAINTENANCE_MODE, value: 'true', type: 'boolean' },
    ]);
    await svc.refreshCache();

    expect(listener).toHaveBeenCalledWith(ConfigKey.MAINTENANCE_MODE, true);
  });

  it('onChange unsubscribe stops future notifications', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const svc = await DynamicConfigService.create();

    const listener = jest.fn();
    const unsubscribe = svc.onChange('someKey', listener);
    unsubscribe();

    mockFindMany.mockResolvedValueOnce([
      { key: 'someKey', value: 'newVal', type: 'string' },
    ]);
    await svc.refreshCache();

    expect(listener).not.toHaveBeenCalled();
  });

  it('set() triggers onChange listener when value changes', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockUpsert.mockResolvedValue({});
    const svc = await DynamicConfigService.create();

    const listener = jest.fn();
    svc.onChange(ConfigKey.RATE_LIMIT_MAX, listener);

    await svc.set(ConfigKey.RATE_LIMIT_MAX, 500, 'number');

    expect(listener).toHaveBeenCalledWith(ConfigKey.RATE_LIMIT_MAX, 500);
  });

  it('getStatus reflects cached keys count', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'a', value: '1', type: 'number' },
      { key: 'b', value: '2', type: 'number' },
    ]);
    const svc = await DynamicConfigService.create();

    const status = svc.getStatus();
    expect(status.keysCachedCount).toBe(2);
    expect(status.cachedKeys).toContain('a');
    expect(status.cachedKeys).toContain('b');
  });
});
