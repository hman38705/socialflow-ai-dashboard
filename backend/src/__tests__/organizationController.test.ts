/**
 * Unit tests for organization controller — member invitation, role assignment,
 * and member removal flows. Closes #1069
 */

// Mock prisma before any module import that depends on it
jest.mock('../lib/prisma', () => ({
  prisma: {
    organizationMember: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

// Prevent real Redis connections — all cache operations are no-ops
jest.mock('../utils/cache', () => ({
  withCache: jest.fn((_key: string, _ttl: number, fetcher: () => unknown) => fetcher()),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
  invalidateCachePattern: jest.fn().mockResolvedValue(undefined),
  CacheTTL: { USER_PROFILE: 300, ORG: 300, ORG_LIST: 120, ANALYTICS: 60, FEED: 30 },
}));

// Stub pagination helpers so tests focus on controller logic, not pagination maths
jest.mock('../utils/pagination', () => ({
  parsePageLimit: jest.fn().mockReturnValue({ page: 1, limit: 20 }),
  toSkipTake: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
  buildPageResponse: jest.fn((_req: unknown, data: unknown[], total: number) => ({
    data,
    pagination: { total },
  })),
}));

import { prisma } from '../lib/prisma';
import { invalidateCachePattern } from '../utils/cache';
import { addMember, removeMember } from '../controllers/organization';
import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeReq(
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  callerId = 'caller-id',
): AuthRequest {
  return {
    params,
    body,
    user: { id: callerId },
    query: {},
    headers: {},
  } as unknown as AuthRequest;
}

function makeRes(): jest.Mocked<Response> {
  const res = {} as jest.Mocked<Response>;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

// ── addMember — member invitation & role assignment ───────────────────────────

describe('addMember — member invitation flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 when the caller has no membership in the org', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id' });
    const res = makeRes();

    await addMember(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is a regular member (not owner or admin)', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'member' });

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id' });
    const res = makeRes();

    await addMember(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it('invites a member with the default "member" role when the caller is an owner', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    const created = { id: 'mbr-1', organizationId: 'org-1', userId: 'new-user-id', role: 'member' };
    (prisma.organizationMember.create as jest.Mock).mockResolvedValue(created);

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id' });
    const res = makeRes();

    await addMember(req, res);

    expect(prisma.organizationMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', userId: 'new-user-id', role: 'member' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it('invites a member with the default "member" role when the caller is an admin', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'admin' });
    const created = { id: 'mbr-2', organizationId: 'org-1', userId: 'new-user-id', role: 'member' };
    (prisma.organizationMember.create as jest.Mock).mockResolvedValue(created);

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id' });
    const res = makeRes();

    await addMember(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  // ── Role assignment within invitation ──────────────────────────────────────

  it('assigns the "admin" role when explicitly requested', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    const created = { id: 'mbr-3', organizationId: 'org-1', userId: 'new-user-id', role: 'admin' };
    (prisma.organizationMember.create as jest.Mock).mockResolvedValue(created);

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id', role: 'admin' });
    const res = makeRes();

    await addMember(req, res);

    expect(prisma.organizationMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'admin' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it('assigns the "viewer" role when explicitly requested', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'admin' });
    const created = { id: 'mbr-4', organizationId: 'org-1', userId: 'new-user-id', role: 'viewer' };
    (prisma.organizationMember.create as jest.Mock).mockResolvedValue(created);

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id', role: 'viewer' });
    const res = makeRes();

    await addMember(req, res);

    expect(prisma.organizationMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'viewer' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it('invalidates the org cache and the invited user org-list cache after invitation', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.organizationMember.create as jest.Mock).mockResolvedValue({
      id: 'mbr-5',
      organizationId: 'org-1',
      userId: 'new-user-id',
      role: 'member',
    });

    const req = makeReq({ orgId: 'org-1' }, { userId: 'new-user-id' });
    const res = makeRes();

    await addMember(req, res);

    expect(invalidateCachePattern).toHaveBeenCalledWith('org:org-1:*');
    expect(invalidateCachePattern).toHaveBeenCalledWith('org-list:new-user-id:*');
  });
});

// ── removeMember — member removal flow ───────────────────────────────────────

describe('removeMember — member removal flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 when the caller has no membership in the org', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ orgId: 'org-1', userId: 'target-id' });
    const res = makeRes();

    await removeMember(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
    expect(prisma.organizationMember.delete).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is a regular member (not owner or admin)', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'member' });

    const req = makeReq({ orgId: 'org-1', userId: 'target-id' });
    const res = makeRes();

    await removeMember(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Insufficient permissions' });
    expect(prisma.organizationMember.delete).not.toHaveBeenCalled();
  });

  it('removes the member and returns 204 when the caller is an owner', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.organizationMember.delete as jest.Mock).mockResolvedValue({});

    const req = makeReq({ orgId: 'org-1', userId: 'target-id' });
    const res = makeRes();

    await removeMember(req, res);

    expect(prisma.organizationMember.delete).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: 'org-1', userId: 'target-id' } },
    });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('removes the member and returns 204 when the caller is an admin', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'admin' });
    (prisma.organizationMember.delete as jest.Mock).mockResolvedValue({});

    const req = makeReq({ orgId: 'org-1', userId: 'target-id' });
    const res = makeRes();

    await removeMember(req, res);

    expect(prisma.organizationMember.delete).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: 'org-1', userId: 'target-id' } },
    });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('invalidates the org cache and the removed user org-list cache after removal', async () => {
    (prisma.organizationMember.findUnique as jest.Mock).mockResolvedValue({ role: 'owner' });
    (prisma.organizationMember.delete as jest.Mock).mockResolvedValue({});

    const req = makeReq({ orgId: 'org-1', userId: 'target-id' });
    const res = makeRes();

    await removeMember(req, res);

    expect(invalidateCachePattern).toHaveBeenCalledWith('org:org-1:*');
    expect(invalidateCachePattern).toHaveBeenCalledWith('org-list:target-id:*');
  });
});
