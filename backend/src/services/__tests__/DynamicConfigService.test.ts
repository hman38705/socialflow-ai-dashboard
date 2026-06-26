import { DynamicConfigService } from '../DynamicConfigService';
import { prisma } from '../../lib/prisma';

// Prevent real DB calls
jest.mock('../../lib/prisma', () => ({
  prisma: { dynamicConfig: { findMany: jest.fn().mockResolvedValue([]) } },
}));

const mockFindMany = (prisma as any).dynamicConfig.findMany as jest.Mock;

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

    // Should NOT fire again before the next 5 s window
    jest.advanceTimersByTime(4999);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    svc.stopPolling();
  });

  it('cache is populated before create() resolves', async () => {
    const mockFindMany = jest.fn().mockResolvedValue([
      { key: 'testKey', value: 'testValue', type: 'string' },
    ]);
    (require('../../lib/prisma').prisma.dynamicConfig.findMany as jest.Mock).mockImplementation(
      mockFindMany,
    );

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

describe('DynamicConfigService – readyPromise guard', () => {
  afterEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
  });

  it('readyPromise is set by create() and resolves to post-refresh data', async () => {
    mockFindMany.mockResolvedValue([{ key: 'rp-key', value: 'rp-value', type: 'string' }]);

    const svc = await DynamicConfigService.create();

    await (svc as any).readyPromise;
    expect(svc.get('rp-key')).toBe('rp-value');

    svc.stopPolling();
  });

  it('get() returns post-refresh data after awaiting readyPromise on a pre-init instance', async () => {
    let resolveRefresh!: () => void;
    const refreshDelay = new Promise<void>((r) => {
      resolveRefresh = r;
    });

    mockFindMany.mockImplementationOnce(() =>
      refreshDelay.then(() => [{ key: 'guard-key', value: 'guard-value', type: 'string' }]),
    );

    // Bypass create() to simulate obtaining the instance before initialization
    // completes — the scenario the readyPromise guard defends against.
    const svc = new (DynamicConfigService as any)(60000) as DynamicConfigService;
    (svc as any).readyPromise = (svc as any).refreshCache();

    // Before refresh: cache is empty, get() returns null (hardcoded default)
    expect(svc.get('guard-key')).toBeNull();

    // Resolve the delayed refresh
    resolveRefresh();
    await (svc as any).readyPromise;

    // After readyPromise settles: get() returns the post-refresh value
    expect(svc.get('guard-key')).toBe('guard-value');

    svc.stopPolling();
  });
});
