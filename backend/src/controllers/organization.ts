import { Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { parsePageLimit, toSkipTake, buildPageResponse } from '../utils/pagination';
import { withCache, invalidateCache, invalidateCachePattern, CacheTTL } from '../utils/cache';

/** POST /api/organizations — create a new org, caller becomes owner */
export async function createOrganization(req: AuthRequest, res: Response): Promise<void> {
  const { name, slug } = req.body as { name: string; slug: string };

  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) {
    res.status(409).json({ message: 'Slug already taken' });
    return;
  }

  const org = await prisma.organization.create({
    data: {
      id: randomUUID(),
      name,
      slug,
      members: {
        create: { id: randomUUID(), userId: req.user!.id, role: 'owner' },
      },
    },
    include: { members: true },
  });

  // Invalidate the caller's org list cache
  await invalidateCachePattern(`org-list:${req.user!.id}:*`);

  res.status(201).json(org);
}

/** GET /api/organizations — list orgs the caller belongs to */
export async function listOrganizations(req: AuthRequest, res: Response): Promise<void> {
  const params = parsePageLimit(req);
  const userId = req.user!.id;
  const cacheKey = `org-list:${userId}:${params.page}:${params.limit}`;

  const result = await withCache(cacheKey, CacheTTL.ORG_LIST, async () => {
    const where = { userId };
    const [total, memberships] = await Promise.all([
      prisma.organizationMember.count({ where }),
      prisma.organizationMember.findMany({
        where,
        include: { organization: true },
        ...toSkipTake(params),
      }),
    ]);
    const data = memberships.map((m: (typeof memberships)[number]) => ({
      ...m.organization,
      role: m.role,
    }));
    return buildPageResponse(req, data, total, params);
  });

  res.json(result);
}

/** GET /api/organizations/:orgId — get a single org (must be a member) */
export async function getOrganization(req: AuthRequest, res: Response): Promise<void> {
  const { orgId } = req.params;

  const membership = await withCache(`org:${orgId}:${req.user!.id}`, CacheTTL.ORG, () =>
    prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
      include: {
        organization: {
          include: { members: { include: { user: { select: { id: true, email: true } } } } },
        },
      },
    }),
  );

  if (!membership) {
    res.status(404).json({ message: 'Organization not found' });
    return;
  }

  res.json({ ...membership.organization, role: membership.role });
}

/** POST /api/organizations/:orgId/members — invite a user by userId */
export async function addMember(req: AuthRequest, res: Response): Promise<void> {
  const { orgId } = req.params;
  const { userId, role = 'member' } = req.body as { userId: string; role?: string };

  // Only owner/admin can invite
  const callerMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
  });
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return;
  }

  const member = await prisma.organizationMember.create({
    data: { id: randomUUID(), organizationId: orgId, userId, role },
  });

  // Invalidate org cache for all affected users
  await Promise.all([
    invalidateCachePattern(`org:${orgId}:*`),
    invalidateCachePattern(`org-list:${userId}:*`),
  ]);

  res.status(201).json(member);
}

/** DELETE /api/organizations/:orgId/members/:userId — remove a member */
export async function removeMember(req: AuthRequest, res: Response): Promise<void> {
  const { orgId, userId } = req.params;

  const callerMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
  });
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return;
  }

  await prisma.organizationMember.delete({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });

  // Invalidate org cache for the removed user and the org itself
  await Promise.all([
    invalidateCachePattern(`org:${orgId}:*`),
    invalidateCachePattern(`org-list:${userId}:*`),
  ]);

  res.status(204).send();
}

/** POST /api/organizations/switch — set active org context (returns confirmation) */
export async function switchOrganization(req: AuthRequest, res: Response): Promise<void> {
  const { orgId } = req.body as { orgId: string };

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
    include: { organization: true },
  });

  if (!membership) {
    res.status(404).json({ message: 'Organization not found or not a member' });
    return;
  }

  // The client should store this orgId and send it as `x-org-id` on subsequent requests
  res.json({ activeOrgId: orgId, organization: membership.organization, role: membership.role });
}
