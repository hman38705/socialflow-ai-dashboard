import { Response, NextFunction } from 'express';
import { AuthRequest } from './authenticate';
import { Permission, RoleStore } from '../models/Role';

/**
 * Middleware factory that enforces one or more permissions.
 * Must be used after `authMiddleware` (requires req.user.id).
 *
 * Usage:
 *   router.post('/posts', authMiddleware, checkPermission('posts:create'), handler)
 *   router.get('/admin', authMiddleware, checkPermission('users:manage', 'roles:manage'), handler)
 */
export function checkPermission(...required: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const missing = required.filter((p) => !RoleStore.hasPermission(userId, p));
    if (missing.length > 0) {
      res.status(403).json({ message: 'Forbidden', missing });
      return;
    }

    next();
  };
}
