import { FeatureService } from '../FeatureService';

describe('FeatureService', () => {
  let service: FeatureService;

  beforeEach(() => {
    service = new FeatureService();
  });

  describe('canary rollout distribution', () => {
    it('should distribute users uniformly across percentage buckets', async () => {
      // Set a 50% canary flag
      await service.setFlag('test-canary', {
        enabled: true,
        strategy: 'canary',
        percentage: 50,
      });

      // Generate 10,000 random user IDs and check distribution
      const totalUsers = 10000;
      let enabledCount = 0;

      for (let i = 0; i < totalUsers; i++) {
        const userId = `user-${Math.random().toString(36).substring(7)}`;
        if (service.isEnabled('test-canary', { userId })) {
          enabledCount++;
        }
      }

      const enabledPercentage = (enabledCount / totalUsers) * 100;

      // Verify distribution is within acceptable range (48-52% for 50% canary)
      expect(enabledPercentage).toBeGreaterThanOrEqual(48);
      expect(enabledPercentage).toBeLessThanOrEqual(52);
    });

    it('should be deterministic for the same user', async () => {
      await service.setFlag('test-canary', {
        enabled: true,
        strategy: 'canary',
        percentage: 50,
      });

      const userId = 'user-123';
      const result1 = service.isEnabled('test-canary', { userId });
      const result2 = service.isEnabled('test-canary', { userId });

      expect(result1).toBe(result2);
    });

    it('should respect 0% canary (always disabled)', async () => {
      await service.setFlag('test-canary-0', {
        enabled: true,
        strategy: 'canary',
        percentage: 0,
      });

      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`;
        expect(service.isEnabled('test-canary-0', { userId })).toBe(false);
      }
    });

    it('should respect 100% canary (always enabled)', async () => {
      await service.setFlag('test-canary-100', {
        enabled: true,
        strategy: 'canary',
        percentage: 100,
      });

      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`;
        expect(service.isEnabled('test-canary-100', { userId })).toBe(true);
      }
    });

    it('should distribute sequential IDs evenly', async () => {
      await service.setFlag('test-sequential', {
        enabled: true,
        strategy: 'canary',
        percentage: 50,
      });

      const totalUsers = 1000;
      let enabledCount = 0;

      // Use sequential numeric IDs to test hash distribution
      for (let i = 0; i < totalUsers; i++) {
        const userId = `user-${i}`;
        if (service.isEnabled('test-sequential', { userId })) {
          enabledCount++;
        }
      }

      const enabledPercentage = (enabledCount / totalUsers) * 100;

      // Verify distribution is within acceptable range
      expect(enabledPercentage).toBeGreaterThanOrEqual(45);
      expect(enabledPercentage).toBeLessThanOrEqual(55);
    });
  });

  describe('boolean strategy', () => {
    it('should enable for all users when strategy is boolean', async () => {
      await service.setFlag('test-boolean', {
        enabled: true,
        strategy: 'boolean',
      });

      expect(service.isEnabled('test-boolean', { userId: 'user-1' })).toBe(true);
      expect(service.isEnabled('test-boolean', { userId: 'user-2' })).toBe(true);
    });

    it('should disable when flag is disabled', async () => {
      await service.setFlag('test-disabled', {
        enabled: false,
        strategy: 'boolean',
      });

      expect(service.isEnabled('test-disabled', { userId: 'user-1' })).toBe(false);
    });
  });

  describe('userlist strategy', () => {
    it('should enable only for specified users', async () => {
      await service.setFlag('test-userlist', {
        enabled: true,
        strategy: 'userlist',
        userIds: ['user-1', 'user-2'],
      });

      expect(service.isEnabled('test-userlist', { userId: 'user-1' })).toBe(true);
      expect(service.isEnabled('test-userlist', { userId: 'user-2' })).toBe(true);
      expect(service.isEnabled('test-userlist', { userId: 'user-3' })).toBe(false);
    });
  });

  describe('group strategy', () => {
    it('should enable only for specified groups', async () => {
      await service.setFlag('test-group', {
        enabled: true,
        strategy: 'group',
        groupIds: ['group-1', 'group-2'],
      });

      expect(service.isEnabled('test-group', { groupId: 'group-1' })).toBe(true);
      expect(service.isEnabled('test-group', { groupId: 'group-2' })).toBe(true);
      expect(service.isEnabled('test-group', { groupId: 'group-3' })).toBe(false);
    });
  });
});
