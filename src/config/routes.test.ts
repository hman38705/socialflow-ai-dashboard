import { crumbChain, metaForPath, titleForPath } from './routes';

describe('metaForPath', () => {
  test('exact match', () => {
    expect(metaForPath('/analytics')?.title).toBe('Analytics');
  });

  test('longest registered prefix for a nested path', () => {
    expect(metaForPath('/settings/security')?.title).toBe('Security');
    expect(metaForPath('/settings/security/whatever')?.title).toBe('Security');
  });

  test('unregistered path has no meta; titleForPath falls back to Dashboard', () => {
    expect(metaForPath('/nowhere')).toBeUndefined();
    expect(titleForPath('/nowhere')).toBe('Dashboard');
  });
});

describe('crumbChain', () => {
  test('a nested route produces the full ancestor chain in order', () => {
    expect(crumbChain('/settings/security').map((c) => c.path)).toEqual([
      '/settings',
      '/settings/security',
    ]);
    expect(crumbChain('/settings/security').map((c) => c.meta.breadcrumb)).toEqual([
      'Settings',
      'Security',
    ]);
  });

  test('a top-level route is a single crumb', () => {
    expect(crumbChain('/analytics').map((c) => c.path)).toEqual(['/analytics']);
  });

  test('unregistered intermediate segments are skipped', () => {
    // `/settings/mystery` is not registered, so only `/settings` survives
    expect(crumbChain('/settings/mystery').map((c) => c.path)).toEqual(['/settings']);
  });

  test('an unregistered route yields an empty chain', () => {
    expect(crumbChain('/nowhere')).toEqual([]);
  });
});
