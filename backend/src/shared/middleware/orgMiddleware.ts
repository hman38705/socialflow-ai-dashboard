import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { prisma } from '../lib/prisma';

/**
 * Resolves the active organization from the `x-org-id` request header.
 * Verifies the authenticated user is a member of that org.
 * Attaches `req.activeOrgId` for downstream use.
 */
export async function orgMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const orgId = req.headers['x-org-id'] as string | undefined;
  if (!orgId) {
    res.status(400).json({ message: 'Missing x-org-id header' });
    return;
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
  });

  if (!membership) {
    res.status(403).json({ message: 'Not a member of this organization' });
    return;
  }

  req.activeOrgId = orgId;
  next();
}
