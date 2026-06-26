import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { checkPermission } from '../middleware/checkPermission';
import { validate } from '../middleware/validate';
import { ROLES, PERMISSIONS, RoleStore, RoleName } from '../models/Role';
import { UserStore } from '../models/User';

const router = Router();

const assignSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'editor', 'viewer']),
});

/**
 * GET /api/roles
 * List all available roles and their permissions.
 */
router.get('/', authMiddleware, (_req: Request, res: Response) => {
  return res.json(Object.values(ROLES));
});

/**
 * GET /api/roles/permissions
 * List all available permissions.
 */
router.get('/permissions', authMiddleware, (_req: Request, res: Response) => {
  return res.json(PERMISSIONS);
});

/**
 * GET /api/roles/assignments
 * List all user→role assignments. Requires: users:read
 */
router.get(
  '/assignments',
  authMiddleware,
  checkPermission('users:read'),
  (_req: Request, res: Response) => {
    return res.json(RoleStore.listAll());
  },
);

/**
 * GET /api/roles/me
 * Returns the current user's role and permissions.
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const role = RoleStore.getRole(req.user!.id);
  if (!role) return res.json({ role: null, permissions: [] });
  return res.json({ role: role.name, permissions: role.permissions });
});

/**
 * POST /api/roles/assign
 * Assign a role to a user. Requires: roles:manage
 */
router.post(
  '/assign',
  authMiddleware,
  checkPermission('roles:manage'),
  validate(assignSchema),
  (req: Request, res: Response) => {
    const { userId, role } = req.body as { userId: string; role: RoleName };
    if (!UserStore.findById(userId)) {
      return res.status(404).json({ message: 'User not found' });
    }
    RoleStore.assign(userId, role);
    return res.json({ userId, role });
  },
);

/**
 * DELETE /api/roles/assign/:userId
 * Remove a user's role (demotes to viewer). Requires: roles:manage
 */
router.delete(
  '/assign/:userId',
  authMiddleware,
  checkPermission('roles:manage'),
  (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!RoleStore.getRoleName(userId)) {
      return res.status(404).json({ message: 'No role assignment found for this user' });
    }
    RoleStore.assign(userId, 'viewer');
    return res.status(204).send();
  },
);

export default router;
