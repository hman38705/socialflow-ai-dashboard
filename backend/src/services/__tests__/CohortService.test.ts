import { CohortService, CohortLabel, UserActivityStats } from '../CohortService';
import { prisma } from '../../lib/prisma';

// Mock Prisma
jest.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('CohortService', () => {
  let service: CohortService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CohortService();
  });

  describe('computeCohorts', () => {
    it('should compute cohorts for all users without organization', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'user-1',
          email: 'user1@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
          postCount: 0,
          orgCount: 1,
          daysSinceJoined: 5,
          daysSinceLastPost: null,
        },
        {
          userId: 'user-2',
          email: 'user2@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000), // 50 days ago
          postCount: 25,
          orgCount: 2,
          daysSinceJoined: 50,
          daysSinceLastPost: 5,
        },
        {
          userId: 'user-3',
          email: 'user3@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), // 200 days ago
          postCount: 0,
          orgCount: 1,
          daysSinceJoined: 200,
          daysSinceLastPost: null,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.computeCohorts();

      expect(result.totalUsers).toBe(3);
      expect(result.segments).toBeDefined();
      expect(result.computedAt).toBeInstanceOf(Date);
      expect(result.organizationId).toBeUndefined();
    });

    it('should compute cohorts scoped to an organization', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'user-1',
          email: 'user1@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          postCount: 0,
          orgCount: 1,
          daysSinceJoined: 3,
          daysSinceLastPost: null,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.computeCohorts('org-123');

      expect(result.organizationId).toBe('org-123');
      expect(result.totalUsers).toBe(1);
    });

    it('should cache results for 1 hour', async () => {
      const mockStats: UserActivityStats[] = [];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      // First call - should fetch from DB
      await service.computeCohorts('org-123');
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(1);

      // Second call - should use cache
      await service.computeCohorts('org-123');
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(1);
    });

    it('should invalidate cache after TTL expires', async () => {
      jest.useFakeTimers();
      const mockStats: UserActivityStats[] = [];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      await service.computeCohorts('org-123');
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(1);

      // Advance time by 1 hour + 1 minute
      jest.advanceTimersByTime(61 * 60 * 1000);

      await service.computeCohorts('org-123');
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(2);

      jest.useRealTimers();
    });

    it('should correctly segment users into cohorts', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'new-user',
          email: 'new@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          postCount: 0,
          orgCount: 1,
          daysSinceJoined: 3,
          daysSinceLastPost: null,
        },
        {
          userId: 'power-user',
          email: 'power@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
          postCount: 50,
          orgCount: 3,
          daysSinceJoined: 100,
          daysSinceLastPost: 2,
        },
        {
          userId: 'lurker',
          email: 'lurker@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
          postCount: 0,
          orgCount: 1,
          daysSinceJoined: 100,
          daysSinceLastPost: null,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.computeCohorts();

      const cohortLabels = result.segments.map((s) => s.cohort);
      expect(cohortLabels).toContain('New Users');
      expect(cohortLabels).toContain('Power Users');
      expect(cohortLabels).toContain('Lurkers');
    });
  });

  describe('getUserCohort', () => {
    it('should return cohort for a specific user', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'user-123',
          email: 'user@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          postCount: 15,
          orgCount: 2,
          daysSinceJoined: 20,
          daysSinceLastPost: 5,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getUserCohort('user-123');

      expect(result.userId).toBe('user-123');
      expect(result.cohort).toBe('Frequent Posters');
      expect(result.stats).toEqual(mockStats[0]);
      expect(result.computedAt).toBeInstanceOf(Date);
    });

    it('should throw error when user not found', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getUserCohort('nonexistent-user')).rejects.toThrow('User not found');
    });

    it('should classify "New Users" correctly', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'new-user',
          email: 'new@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          postCount: 5,
          orgCount: 1,
          daysSinceJoined: 3,
          daysSinceLastPost: 1,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getUserCohort('new-user');

      expect(result.cohort).toBe('New Users');
    });

    it('should classify "Power Users" correctly', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'power-user',
          email: 'power@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
          postCount: 50,
          orgCount: 3,
          daysSinceJoined: 100,
          daysSinceLastPost: 2,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getUserCohort('power-user');

      expect(result.cohort).toBe('Power Users');
    });

    it('should classify "Lurkers" correctly', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'lurker',
          email: 'lurker@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
          postCount: 0,
          orgCount: 1,
          daysSinceJoined: 100,
          daysSinceLastPost: null,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getUserCohort('lurker');

      expect(result.cohort).toBe('Lurkers');
    });

    it('should classify "Churned Users" correctly', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'churned-user',
          email: 'churned@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
          postCount: 5,
          orgCount: 1,
          daysSinceJoined: 200,
          daysSinceLastPost: 120,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getUserCohort('churned-user');

      expect(result.cohort).toBe('Churned Users');
    });

    it('should classify "At-Risk Users" correctly', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'at-risk-user',
          email: 'atrisk@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
          postCount: 5,
          orgCount: 1,
          daysSinceJoined: 100,
          daysSinceLastPost: 60,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getUserCohort('at-risk-user');

      expect(result.cohort).toBe('At-Risk Users');
    });
  });

  describe('invalidateCache', () => {
    it('should invalidate global cache', async () => {
      const mockStats: UserActivityStats[] = [];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      // Populate cache
      await service.computeCohorts();
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(1);

      // Invalidate cache
      service.invalidateCache();

      // Should fetch from DB again
      await service.computeCohorts();
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(2);
    });

    it('should invalidate organization-specific cache', async () => {
      const mockStats: UserActivityStats[] = [];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      // Populate cache for org-123
      await service.computeCohorts('org-123');
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(1);

      // Invalidate cache for org-123
      service.invalidateCache('org-123');

      // Should fetch from DB again
      await service.computeCohorts('org-123');
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBe(2);

      // But cache for other orgs should be unaffected (if populated)
    });
  });

  describe('edge cases', () => {
    it('should handle empty user list', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.computeCohorts();

      expect(result.totalUsers).toBe(0);
      expect(result.segments).toHaveLength(0);
    });

    it('should handle users with null daysSinceLastPost', async () => {
      const mockStats: UserActivityStats[] = [
        {
          userId: 'user-1',
          email: 'user1@example.com',
          role: 'user',
          joinedAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000),
          postCount: 5,
          orgCount: 1,
          daysSinceJoined: 50,
          daysSinceLastPost: null,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.computeCohorts();

      expect(result.totalUsers).toBe(1);
      expect(result.segments).toBeDefined();
    });
  });
});
