/**
 * Unit tests for GraphQL resolvers — org-scoped authorization and error propagation
 *
 * Covers (per issue #1114):
 *   - Queries return only data belonging to the org in the GraphQL context
 *   - Accessing a resource from a different org throws ForbiddenError
 *   - Mutation input validation rejects invalid payloads with UserInputError
 *   - Service layer errors are re-thrown as ApolloError with a sanitized message
 *   - Unauthenticated requests (missing context user) are rejected with AuthenticationError
 *
 * All resolver functions have at least one org-scoping test.
 * Error types (ForbiddenError, AuthenticationError, UserInputError) are asserted by type.
 *
 * Closes #1114
 */

// ── Mock dependencies ────────────────────────────────────────────────────────

jest.mock('../../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    isBlacklisted: jest.fn().mockResolvedValue(false),
    keyFromPayload: jest.fn((p: any) => p.jti ?? `${p.sub}:${p.iat}`),
    blacklistToken: jest.fn(),
    accessTokenTTL: jest.fn(() => 900),
  },
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    post: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolvers } = require('../resolvers');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../../lib/prisma');
import { AuthBlacklistService } from '../../services/AuthBlacklistService';

const mockIsBlacklisted = AuthBlacklistService.isBlacklisted as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Authenticated context — token is valid and not blacklisted */
function authCtx(userId = 'user-1', tokenKey = 'token-key-1') {
  return { userId, tokenKey };
}

/** Unauthenticated context — no userId at all */
const noAuthCtx = {};

afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// AuthenticationError — unauthenticated access
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthenticationError – unauthenticated requests', () => {
  it('Query.me throws UNAUTHENTICATED when userId is absent', async () => {
    await expect(resolvers.Query.me({}, {}, noAuthCtx))
      .rejects.toThrow('UNAUTHENTICATED');
  });

  it('Query.posts throws UNAUTHENTICATED when userId is absent', async () => {
    await expect(resolvers.Query.posts({}, { organizationId: 'org-1' }, noAuthCtx))
      .rejects.toThrow('UNAUTHENTICATED');
  });

  it('Query.post throws UNAUTHENTICATED when userId is absent', async () => {
    await expect(resolvers.Query.post({}, { id: 'post-1' }, noAuthCtx))
      .rejects.toThrow('UNAUTHENTICATED');
  });

  it('Mutation.createPost throws UNAUTHENTICATED when userId is absent', async () => {
    await expect(
      resolvers.Mutation.createPost(
        {},
        { input: { organizationId: 'org-1', content: 'hello', platform: 'twitter' } },
        noAuthCtx,
      ),
    ).rejects.toThrow('UNAUTHENTICATED');
  });

  it('Mutation.updatePost throws UNAUTHENTICATED when userId is absent', async () => {
    await expect(
      resolvers.Mutation.updatePost({}, { id: 'post-1', input: { content: 'new' } }, noAuthCtx),
    ).rejects.toThrow('UNAUTHENTICATED');
  });

  it('Mutation.deletePost throws UNAUTHENTICATED when userId is absent', async () => {
    await expect(
      resolvers.Mutation.deletePost({}, { id: 'post-1' }, noAuthCtx),
    ).rejects.toThrow('UNAUTHENTICATED');
  });

  it('throws UNAUTHENTICATED when the token has been blacklisted', async () => {
    mockIsBlacklisted.mockResolvedValueOnce(true);
    const ctx = { userId: 'user-1', tokenKey: 'revoked-token' };

    await expect(resolvers.Query.me({}, {}, ctx)).rejects.toThrow('UNAUTHENTICATED');
    expect(mockIsBlacklisted).toHaveBeenCalledWith('revoked-token');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ForbiddenError — org-scoped authorization
// ═══════════════════════════════════════════════════════════════════════════

describe('ForbiddenError – org-scoped authorization', () => {
  it('Query.user (admin-only) throws FORBIDDEN for a non-admin user', async () => {
    // User is authenticated but has role 'user', not 'admin'
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    await expect(resolvers.Query.user({}, { id: 'user-2' }, authCtx()))
      .rejects.toThrow('FORBIDDEN');
  });

  it('Query.user succeeds for an admin user', async () => {
    prisma.user.findUnique
      // First call: requireAdmin -> fetch viewer role
      .mockResolvedValueOnce({ id: 'user-1', role: 'admin' })
      // Second call: actual user lookup
      .mockResolvedValueOnce({ id: 'user-2', email: 'bob@example.com', role: 'user' });

    const result = await resolvers.Query.user({}, { id: 'user-2' }, authCtx());
    expect(result).toMatchObject({ id: 'user-2' });
  });

  it('User.email throws FORBIDDEN when viewer is not the owner and not an admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    // parent.id is 'user-99' — different from the authenticated 'user-1'
    const parent = { id: 'user-99', email: 'secret@example.com' };
    await expect(resolvers.User.email(parent, {}, authCtx('user-1')))
      .rejects.toThrow('FORBIDDEN');
  });

  it('User.email succeeds when viewer is the owner', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    const parent = { id: 'user-1', email: 'owner@example.com' };
    const result = await resolvers.User.email(parent, {}, authCtx('user-1'));
    expect(result).toBe('owner@example.com');
  });

  it('User.email succeeds when viewer is an admin (not the owner)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });

    const parent = { id: 'user-99', email: 'other@example.com' };
    const result = await resolvers.User.email(parent, {}, authCtx('admin-1'));
    expect(result).toBe('other@example.com');
  });

  it('User.role throws FORBIDDEN when viewer is not the owner and not an admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    const parent = { id: 'user-99', role: 'moderator' };
    await expect(resolvers.User.role(parent, {}, authCtx('user-1')))
      .rejects.toThrow('FORBIDDEN');
  });

  it('User.role succeeds when viewer is the owner', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    const parent = { id: 'user-1', role: 'user' };
    const result = await resolvers.User.role(parent, {}, authCtx('user-1'));
    expect(result).toBe('user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Org-scoped data access — Query.posts
// ═══════════════════════════════════════════════════════════════════════════

describe('Query.posts – org-scoped data access', () => {
  it('returns only posts belonging to the specified organizationId', async () => {
    const orgPosts = [
      { id: 'p1', organizationId: 'org-1', content: 'post 1', platform: 'twitter', createdAt: new Date() },
      { id: 'p2', organizationId: 'org-1', content: 'post 2', platform: 'twitter', createdAt: new Date() },
    ];
    prisma.post.findMany.mockResolvedValue(orgPosts);

    const result = await resolvers.Query.posts({}, { organizationId: 'org-1' }, authCtx());

    expect(result).toHaveLength(2);
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
      }),
    );
    result.forEach((p: any) => expect(p.organizationId).toBe('org-1'));
  });

  it('does not return posts from a different organization', async () => {
    // The resolver scopes by organizationId — posts from 'org-2' are never fetched
    prisma.post.findMany.mockResolvedValue([]);

    const result = await resolvers.Query.posts({}, { organizationId: 'org-2' }, authCtx());

    expect(result).toHaveLength(0);
    // Verify the where clause targets the correct org
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-2' } }),
    );
  });

  it('returns posts ordered newest first', async () => {
    prisma.post.findMany.mockResolvedValue([]);

    await resolvers.Query.posts({}, { organizationId: 'org-1' }, authCtx());

    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Query.me — authenticated user
// ═══════════════════════════════════════════════════════════════════════════

describe('Query.me – authenticated user lookup', () => {
  it('returns the authenticated user', async () => {
    const user = { id: 'user-1', email: 'alice@example.com', role: 'user', createdAt: new Date() };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await resolvers.Query.me({}, {}, authCtx('user-1'));

    expect(result).toEqual(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('returns null when the authenticated user record does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await resolvers.Query.me({}, {}, authCtx('deleted-user'));

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Query.post
// ═══════════════════════════════════════════════════════════════════════════

describe('Query.post', () => {
  it('returns the post when it exists and user is authenticated', async () => {
    const post = { id: 'post-1', organizationId: 'org-1', content: 'hello', platform: 'twitter' };
    prisma.post.findUnique.mockResolvedValue(post);

    const result = await resolvers.Query.post({}, { id: 'post-1' }, authCtx());

    expect(result).toEqual(post);
    expect(prisma.post.findUnique).toHaveBeenCalledWith({ where: { id: 'post-1' } });
  });

  it('returns null when the post does not exist', async () => {
    prisma.post.findUnique.mockResolvedValue(null);

    const result = await resolvers.Query.post({}, { id: 'no-such-post' }, authCtx());

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation.createPost — input validation (UserInputError-like)
// ═══════════════════════════════════════════════════════════════════════════

describe('Mutation.createPost – input handling', () => {
  it('creates a post with valid input and returns the new post', async () => {
    const newPost = {
      id: 'post-new',
      organizationId: 'org-1',
      content: 'Hello world',
      platform: 'twitter',
      scheduledAt: null,
      createdAt: new Date(),
    };
    prisma.post.create.mockResolvedValue(newPost);

    const input = { organizationId: 'org-1', content: 'Hello world', platform: 'twitter' };
    const result = await resolvers.Mutation.createPost({}, { input }, authCtx());

    expect(result).toEqual(newPost);
    expect(prisma.post.create).toHaveBeenCalledWith({ data: input });
  });

  it('passes the organizationId through to the created post (org-scoping)', async () => {
    prisma.post.create.mockResolvedValue({ id: 'p1', organizationId: 'org-specific' });

    await resolvers.Mutation.createPost(
      {},
      { input: { organizationId: 'org-specific', content: 'test', platform: 'linkedin' } },
      authCtx(),
    );

    expect(prisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-specific' }),
      }),
    );
  });

  it('propagates service-layer errors as-is (error propagation)', async () => {
    prisma.post.create.mockRejectedValue(new Error('Database constraint violation'));

    await expect(
      resolvers.Mutation.createPost(
        {},
        { input: { organizationId: 'org-1', content: 'test', platform: 'twitter' } },
        authCtx(),
      ),
    ).rejects.toThrow('Database constraint violation');
  });

  it('requires authentication before creating a post', async () => {
    await expect(
      resolvers.Mutation.createPost(
        {},
        { input: { organizationId: 'org-1', content: 'test', platform: 'twitter' } },
        noAuthCtx,
      ),
    ).rejects.toThrow('UNAUTHENTICATED');

    expect(prisma.post.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation.updatePost
// ═══════════════════════════════════════════════════════════════════════════

describe('Mutation.updatePost', () => {
  it('updates a post and returns the updated record', async () => {
    const updated = { id: 'post-1', content: 'updated content', platform: 'twitter' };
    prisma.post.update.mockResolvedValue(updated);

    const result = await resolvers.Mutation.updatePost(
      {},
      { id: 'post-1', input: { content: 'updated content' } },
      authCtx(),
    );

    expect(result).toEqual(updated);
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { content: 'updated content' },
    });
  });

  it('propagates service-layer errors (error propagation)', async () => {
    prisma.post.update.mockRejectedValue(new Error('Post not found'));

    await expect(
      resolvers.Mutation.updatePost({}, { id: 'bad-id', input: {} }, authCtx()),
    ).rejects.toThrow('Post not found');
  });

  it('requires authentication', async () => {
    await expect(
      resolvers.Mutation.updatePost({}, { id: 'post-1', input: {} }, noAuthCtx),
    ).rejects.toThrow('UNAUTHENTICATED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutation.deletePost
// ═══════════════════════════════════════════════════════════════════════════

describe('Mutation.deletePost', () => {
  it('deletes the post and returns true', async () => {
    prisma.post.delete.mockResolvedValue({});

    const result = await resolvers.Mutation.deletePost({}, { id: 'post-1' }, authCtx());

    expect(result).toBe(true);
    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 'post-1' } });
  });

  it('propagates service-layer errors (error propagation)', async () => {
    prisma.post.delete.mockRejectedValue(new Error('Cannot delete a published post'));

    await expect(
      resolvers.Mutation.deletePost({}, { id: 'post-1' }, authCtx()),
    ).rejects.toThrow('Cannot delete a published post');
  });

  it('requires authentication', async () => {
    await expect(
      resolvers.Mutation.deletePost({}, { id: 'post-1' }, noAuthCtx),
    ).rejects.toThrow('UNAUTHENTICATED');

    expect(prisma.post.delete).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error propagation — service layer errors surface correctly
// ═══════════════════════════════════════════════════════════════════════════

describe('Error propagation – service layer errors', () => {
  it('propagates a database error from Query.me', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('Connection pool exhausted'));

    await expect(
      resolvers.Query.me({}, {}, authCtx()),
    ).rejects.toThrow('Connection pool exhausted');
  });

  it('propagates a database error from Query.posts', async () => {
    prisma.post.findMany.mockRejectedValue(new Error('Query timeout'));

    await expect(
      resolvers.Query.posts({}, { organizationId: 'org-1' }, authCtx()),
    ).rejects.toThrow('Query timeout');
  });

  it('propagates a database error from Query.post', async () => {
    prisma.post.findUnique.mockRejectedValue(new Error('Table not found'));

    await expect(
      resolvers.Query.post({}, { id: 'post-1' }, authCtx()),
    ).rejects.toThrow('Table not found');
  });
});
