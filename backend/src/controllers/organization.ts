import { Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/authenticate';
import { parsePageLimit, toSkipTake, buildPageResponse } from '../utils/pagination';
import { withCache, invalidateCachePattern, CacheTTL } from '../utils/cache';
import { UserStore } from '../models/User';

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

/** POST /api/organizations/:orgId/members — invite a user by userId or email */
export async function addMember(req: AuthRequest, res: Response): Promise<void> {
  const { orgId } = req.params;
  const {
    userId: bodyUserId,
    email,
    role = 'member',
  } = req.body as {
    userId?: string;
    email?: string;
    role?: string;
  };

  // Only owner/admin can invite
  const callerMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
  });
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return;
  }

  // Only an existing owner can grant the owner role. Without this, an admin
  // could hand out owner-level access to themselves (an alt account) or an
  // accomplice — a privilege escalation from admin to owner.
  if (role === 'owner' && callerMembership.role !== 'owner') {
    res.status(403).json({ message: 'Only an owner can grant the owner role' });
    return;
  }

  let userId = bodyUserId;
  if (!userId && email) {
    const user = await UserStore.findByEmail(email);
    if (!user) {
      res.status(404).json({ message: 'No user found with that email' });
      return;
    }
    userId = user.id;
  }
  if (!userId) {
    res.status(400).json({ message: 'userId or email is required' });
    return;
  }

  const existingMember = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (existingMember) {
    res.status(409).json({ message: 'User is already a member of this organization' });
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

/** PATCH /api/organizations/:orgId/members/:userId — change a member's role */
export async function updateMemberRole(req: AuthRequest, res: Response): Promise<void> {
  const { orgId, userId } = req.params;
  const { role } = req.body as { role: string };

  const callerMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
  });
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return;
  }

  const targetMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (!targetMembership) {
    res.status(404).json({ message: 'Member not found' });
    return;
  }

  // Only an existing owner can grant or revoke the owner role (same rationale as addMember).
  if (
    (role === 'owner' || targetMembership.role === 'owner') &&
    callerMembership.role !== 'owner'
  ) {
    res.status(403).json({ message: 'Only an owner can change an owner-level role' });
    return;
  }

  // Never let the org end up without an owner.
  if (targetMembership.role === 'owner' && role !== 'owner') {
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId: orgId, role: 'owner' },
    });
    if (ownerCount <= 1) {
      res.status(403).json({ message: 'Cannot demote the last owner of an organization' });
      return;
    }
  }

  const updated = await prisma.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: { role },
  });

  await Promise.all([
    invalidateCachePattern(`org:${orgId}:*`),
    invalidateCachePattern(`org-list:${userId}:*`),
  ]);

  res.json(updated);
}

/** PATCH /api/organizations/:orgId — update organization settings (name/slug) */
export async function updateOrganization(req: AuthRequest, res: Response): Promise<void> {
  const { orgId } = req.params;
  const { name, slug } = req.body as { name?: string; slug?: string };

  const callerMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
  });
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return;
  }

  if (slug) {
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing && existing.id !== orgId) {
      res.status(409).json({ message: 'Slug already taken' });
      return;
    }
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: { ...(name ? { name } : {}), ...(slug ? { slug } : {}) },
  });

  await Promise.all([
    invalidateCachePattern(`org:${orgId}:*`),
    invalidateCachePattern(`org-list:${req.user!.id}:*`),
  ]);

  res.json(updated);
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

  const targetMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });

  if (targetMembership?.role === 'owner') {
    // Only another owner may remove an owner-level member.
    if (callerMembership.role !== 'owner') {
      res.status(403).json({ message: 'Only an owner can remove an owner' });
      return;
    }

    // Never let the org end up without an owner.
    const ownerCount = await prisma.organizationMember.count({
      where: { organizationId: orgId, role: 'owner' },
    });
    if (ownerCount <= 1) {
      res.status(403).json({ message: 'Cannot remove the last owner of an organization' });
      return;
    }
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
