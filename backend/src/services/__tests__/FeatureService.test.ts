/**
 * Unit tests for FeatureService
 *
 * Covers:
 *  1. Flag evaluation — boolean, userlist, group strategies
 *  2. Canary rollout percentage — 0%, 100%, determinism, distribution
 *  3. Unknown-flag behavior — returns false, never throws
 */

import { FeatureService } from '../FeatureService';
import { DynamicConfigService } from '../DynamicConfigService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../lib/prisma', () => ({
  prisma: {
    dynamicConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
  },
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let service: FeatureService;

beforeEach(async () => {
  // Ensure a cached DynamicConfigService instance exists for synchronous reads
  const instance = await DynamicConfigService.create();
  // Expose it as the singleton so FeatureService.getCachedInstance() returns it
  (DynamicConfigService as any)._dynamicConfigServiceInstance = instance;
  // Patch the module-level variable through the same closure used by getCachedInstance
  // (the function closes over _dynamicConfigServiceInstance in the module scope)
  // We re-assign via the mock upsert so setFlag works without a real DB
  const { prisma } = require('../../lib/prisma');
  (prisma.dynamicConfig.upsert as jest.Mock).mockImplementation(({ create }: any) => {
    // Simulate what DynamicConfigService.set() does: update the cache
    const parsed = (() => {
      try { return JSON.parse(create.value); } catch { return create.value; }
    })();
    (instance as any).cache.set(create.key, parsed);
    return Promise.resolve({});
  });

  service = new FeatureService();
  // Wire the singleton so getCachedInstance() returns our instance
  (DynamicConfigService as any)._instance = instance;
  // Override getCachedInstance to return our freshly-created instance
  (DynamicConfigService as any).getCachedInstance = () => instance;
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Boolean strategy
// ---------------------------------------------------------------------------

describe('FeatureService — boolean strategy', () => {
  it('returns true for any user when flag is enabled with boolean strategy', async () => {
    await service.setFlag('feat-bool-on', { enabled: true, strategy: 'boolean' });
    expect(service.isEnabled('feat-bool-on', { userId: 'u1' })).toBe(true);
    expect(service.isEnabled('feat-bool-on', { userId: 'u2' })).toBe(true);
    expect(service.isEnabled('feat-bool-on')).toBe(true);
  });

  it('returns false for any user when flag.enabled is false', async () => {
    await service.setFlag('feat-bool-off', { enabled: false, strategy: 'boolean' });
    expect(service.isEnabled('feat-bool-off', { userId: 'u1' })).toBe(false);
    expect(service.isEnabled('feat-bool-off')).toBe(false);
  });

  it('returns false when context is empty and strategy is boolean but enabled is false', async () => {
    await service.setFlag('feat-disabled', { enabled: false, strategy: 'boolean' });
    expect(service.isEnabled('feat-disabled', {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Userlist strategy
// ---------------------------------------------------------------------------

describe('FeatureService — userlist strategy', () => {
  it('returns true for a user in the userIds list', async () => {
    await service.setFlag('feat-userlist', {
      enabled: true,
      strategy: 'userlist',
      userIds: ['user-A', 'user-B'],
    });
    expect(service.isEnabled('feat-userlist', { userId: 'user-A' })).toBe(true);
    expect(service.isEnabled('feat-userlist', { userId: 'user-B' })).toBe(true);
  });

  it('returns false for a user NOT in the userIds list', async () => {
    await service.setFlag('feat-userlist', {
      enabled: true,
      strategy: 'userlist',
      userIds: ['user-A'],
    });
    expect(service.isEnabled('feat-userlist', { userId: 'user-Z' })).toBe(false);
  });

  it('returns false when no userId is provided in context', async () => {
    await service.setFlag('feat-userlist-nouser', {
      enabled: true,
      strategy: 'userlist',
      userIds: ['user-A'],
    });
    expect(service.isEnabled('feat-userlist-nouser', {})).toBe(false);
    expect(service.isEnabled('feat-userlist-nouser')).toBe(false);
  });

  it('returns false for an empty userIds array', async () => {
    await service.setFlag('feat-userlist-empty', {
      enabled: true,
      strategy: 'userlist',
      userIds: [],
    });
    expect(service.isEnabled('feat-userlist-empty', { userId: 'anyone' })).toBe(false);
  });

  it('is case-sensitive when matching user IDs', async () => {
    await service.setFlag('feat-userlist-case', {
      enabled: true,
      strategy: 'userlist',
      userIds: ['User-1'],
    });
    expect(service.isEnabled('feat-userlist-case', { userId: 'user-1' })).toBe(false);
    expect(service.isEnabled('feat-userlist-case', { userId: 'User-1' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Group strategy
// ---------------------------------------------------------------------------

describe('FeatureService — group strategy', () => {
  it('returns true for a groupId in the groupIds list', async () => {
    await service.setFlag('feat-group', {
      enabled: true,
      strategy: 'group',
      groupIds: ['org-1', 'org-2'],
    });
    expect(service.isEnabled('feat-group', { groupId: 'org-1' })).toBe(true);
    expect(service.isEnabled('feat-group', { groupId: 'org-2' })).toBe(true);
  });

  it('returns false for a groupId NOT in the groupIds list', async () => {
    await service.setFlag('feat-group', {
      enabled: true,
      strategy: 'group',
      groupIds: ['org-1'],
    });
    expect(service.isEnabled('feat-group', { groupId: 'org-99' })).toBe(false);
  });

  it('returns false when no groupId is provided in context', async () => {
    await service.setFlag('feat-group-nogroup', {
      enabled: true,
      strategy: 'group',
      groupIds: ['org-1'],
    });
    expect(service.isEnabled('feat-group-nogroup', {})).toBe(false);
    expect(service.isEnabled('feat-group-nogroup')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Canary rollout — 0% and 100% edge cases
// ---------------------------------------------------------------------------

describe('FeatureService — canary rollout percentage edge cases', () => {
  it('always returns false at 0% canary for any user', async () => {
    await service.setFlag('canary-0', {
      enabled: true,
      strategy: 'canary',
      percentage: 0,
    });
    for (let i = 0; i < 50; i++) {
      expect(service.isEnabled('canary-0', { userId: `user-${i}` })).toBe(false);
    }
  });

  it('always returns true at 100% canary for any user', async () => {
    await service.setFlag('canary-100', {
      enabled: true,
      strategy: 'canary',
      percentage: 100,
    });
    for (let i = 0; i < 50; i++) {
      expect(service.isEnabled('canary-100', { userId: `user-${i}` })).toBe(true);
    }
  });

  it('is deterministic — same user always gets the same result', async () => {
    await service.setFlag('canary-det', {
      enabled: true,
      strategy: 'canary',
      percentage: 50,
    });
    const userId = 'user-deterministic-42';
    const results = Array.from({ length: 10 }, () =>
      service.isEnabled('canary-det', { userId }),
    );
    expect(new Set(results).size).toBe(1); // all identical
  });

  it('two different users can get different results', async () => {
    await service.setFlag('canary-diff', {
      enabled: true,
      strategy: 'canary',
      percentage: 50,
    });
    // With enough users, at least one pair must differ
    const results = Array.from({ length: 200 }, (_, i) =>
      service.isEnabled('canary-diff', { userId: `user-${i}` }),
    );
    const trueCount = results.filter(Boolean).length;
    // At 50% we expect both outcomes to appear in 200 samples
    expect(trueCount).toBeGreaterThan(0);
    expect(trueCount).toBeLessThan(200);
  });

  it('distributes ~50% of users correctly over a large sample', async () => {
    await service.setFlag('canary-dist', {
      enabled: true,
      strategy: 'canary',
      percentage: 50,
    });
    const N = 2000;
    const enabled = Array.from({ length: N }, (_, i) =>
      service.isEnabled('canary-dist', { userId: `u-${i}` }),
    ).filter(Boolean).length;

    const pct = (enabled / N) * 100;
    // Allow ±5 pp around 50%
    expect(pct).toBeGreaterThanOrEqual(45);
    expect(pct).toBeLessThanOrEqual(55);
  });

  it('uses groupId as the hash seed when userId is absent', async () => {
    await service.setFlag('canary-group-seed', {
      enabled: true,
      strategy: 'canary',
      percentage: 50,
    });
    const groupId = 'group-seed-xyz';
    const r1 = service.isEnabled('canary-group-seed', { groupId });
    const r2 = service.isEnabled('canary-group-seed', { groupId });
    expect(r1).toBe(r2);
  });

  it('uses "anonymous" seed when context is empty', async () => {
    await service.setFlag('canary-anon', {
      enabled: true,
      strategy: 'canary',
      percentage: 50,
    });
    const r1 = service.isEnabled('canary-anon');
    const r2 = service.isEnabled('canary-anon', {});
    // Both calls use "anonymous" seed — results must match
    expect(r1).toBe(r2);
  });

  it('percentage missing (undefined) defaults to 0 — always false', async () => {
    await service.setFlag('canary-no-pct', {
      enabled: true,
      strategy: 'canary',
      // percentage intentionally omitted
    });
    for (let i = 0; i < 20; i++) {
      expect(service.isEnabled('canary-no-pct', { userId: `u-${i}` })).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Unknown-flag behavior
// ---------------------------------------------------------------------------

describe('FeatureService — unknown-flag behavior', () => {
  it('returns false for a flag that has never been set', () => {
    expect(service.isEnabled('flag-that-does-not-exist')).toBe(false);
  });

  it('returns false when called with a context for an unknown flag', () => {
    expect(service.isEnabled('no-such-flag', { userId: 'u1' })).toBe(false);
    expect(service.isEnabled('no-such-flag', { groupId: 'g1' })).toBe(false);
  });

  it('does not throw for an unknown flag name', () => {
    expect(() => service.isEnabled('ghost-flag')).not.toThrow();
  });

  it('returns false after a flag is disabled', async () => {
    await service.setFlag('feat-toggle', { enabled: true, strategy: 'boolean' });
    expect(service.isEnabled('feat-toggle')).toBe(true);

    await service.setFlag('feat-toggle', { enabled: false, strategy: 'boolean' });
    expect(service.isEnabled('feat-toggle')).toBe(false);
  });

  it('treats a flag with an unrecognised strategy as disabled', async () => {
    await service.setFlag('feat-unknown-strategy', {
      enabled: true,
      strategy: 'nonexistent' as any,
    });
    expect(service.isEnabled('feat-unknown-strategy', { userId: 'u1' })).toBe(false);
  });
});
