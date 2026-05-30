import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/authenticate';
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
 * @openapi
 * /roles:
 *   get:
 *     tags: [Roles]
 *     summary: List all available roles and their permissions
 *     responses:
 *       200:
 *         description: Role list
 */
router.get('/', authMiddleware, (_req: Request, res: Response) => {
  return res.json(Object.values(ROLES));
});

/**
 * @openapi
 * /roles/permissions:
 *   get:
 *     tags: [Roles]
 *     summary: List all available permissions
 *     responses:
 *       200:
 *         description: Permission list
 */
router.get('/permissions', authMiddleware, (_req: Request, res: Response) => {
  return res.json(PERMISSIONS);
});

/**
 * @openapi
 * /roles/assignments:
 *   get:
 *     tags: [Roles]
 *     summary: List all user→role assignments (requires users:read permission)
 *     responses:
 *       200:
 *         description: Role assignments
 *       403:
 *         description: Forbidden
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
 * @openapi
 * /roles/me:
 *   get:
 *     tags: [Roles]
 *     summary: Get the current user's role and permissions
 *     responses:
 *       200:
 *         description: Current user role
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const role = RoleStore.getRole(req.user!.id);
  if (!role) return res.json({ role: null, permissions: [] });
  return res.json({ role: role.name, permissions: role.permissions });
});

/**
 * @openapi
 * /roles/assign:
 *   post:
 *     tags: [Roles]
 *     summary: Assign a role to a user (requires roles:manage permission)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, role]
 *             properties:
 *               userId:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, editor, viewer]
 *     responses:
 *       200:
 *         description: Role assigned
 *       404:
 *         description: User not found
 *       403:
 *         description: Forbidden
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
 * @openapi
 * /roles/assign/{userId}:
 *   delete:
 *     tags: [Roles]
 *     summary: Remove a user's role (demotes to viewer, requires roles:manage)
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Role removed
 *       404:
 *         description: No role assignment found
 *       403:
 *         description: Forbidden
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
