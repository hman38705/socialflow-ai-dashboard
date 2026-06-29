import { AuthBlacklistService } from '../../services/AuthBlacklistService';

jest.mock('../../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    isBlacklisted: jest.fn(),
    keyFromPayload: jest.fn((p: any) => p.jti ?? `${p.sub}:${p.iat}`),
    blacklistToken: jest.fn(),
    accessTokenTTL: jest.fn(() => 900),
  },
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    post: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// Import resolvers AFTER mocks are set up
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolvers } = require('../resolvers');

const mockIsBlacklisted = AuthBlacklistService.isBlacklisted as jest.Mock;

describe('GraphQL requireAuth – blacklist enforcement', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws UNAUTHENTICATED when userId is missing', async () => {
    await expect(resolvers.Query.me({}, {}, {})).rejects.toThrow('UNAUTHENTICATED');
  });

  it('throws UNAUTHENTICATED when token is blacklisted', async () => {
    mockIsBlacklisted.mockResolvedValue(true);
    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    await expect(resolvers.Query.me({}, {}, ctx)).rejects.toThrow('UNAUTHENTICATED');
    expect(mockIsBlacklisted).toHaveBeenCalledWith('jti-abc');
  });

  it('allows the query when token is valid and not blacklisted', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    const result = await resolvers.Query.me({}, {}, ctx);
    expect(result).toEqual({ id: 'user-1' });
    expect(mockIsBlacklisted).toHaveBeenCalledWith('jti-abc');
  });

  it('skips blacklist check when no tokenKey is present (legacy context)', async () => {
    const { prisma } = require('../../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });

    const ctx = { userId: 'user-2' }; // no tokenKey
    const result = await resolvers.Query.me({}, {}, ctx);
    expect(result).toEqual({ id: 'user-2' });
    expect(mockIsBlacklisted).not.toHaveBeenCalled();
  });
});

describe('Subscription.orgUpdate – org membership validation', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws FORBIDDEN when the subscriber belongs to a different org', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ organizationId: 'org-a' });

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    await expect(
      resolvers.Subscription.orgUpdate.subscribe({}, { orgId: 'org-b' }, ctx),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('resolves the iterator when the subscriber belongs to the requested org', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ organizationId: 'org-a' });

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    // Should not throw — returns an async iterator
    const result = await resolvers.Subscription.orgUpdate.subscribe({}, { orgId: 'org-a' }, ctx);
    expect(result).toBeDefined();
  });

  it('throws UNAUTHENTICATED when there is no userId in context', async () => {
    const ctx = {};
    await expect(
      resolvers.Subscription.orgUpdate.subscribe({}, { orgId: 'org-a' }, ctx),
    ).rejects.toThrow('UNAUTHENTICATED');
  });
});
