import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/authenticate';
import { AuditLogStore } from '../models/AuditLog';
import { parsePageLimit, buildPageResponse } from '../utils/pagination';

const router = Router();

/**
 * @openapi
 * /audit:
 *   get:
 *     tags: [Audit]
 *     summary: List recent audit log entries (admin view)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Paged audit log
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PagedResponse'
 *       401:
 *         description: Unauthorized
 */
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const params = parsePageLimit(req);
  const all = AuditLogStore.recent(500);
  const total = all.length;
  const start = (params.page - 1) * params.limit;
  const data = all.slice(start, start + params.limit);
  return res.json(buildPageResponse(req, data, total, params));
});

/**
 * @openapi
 * /audit/me:
 *   get:
 *     tags: [Audit]
 *     summary: List audit log entries for the authenticated user
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paged audit log for current user
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const params = parsePageLimit(req);
  const all = AuditLogStore.forActor(req.user!.id, 500);
  const total = all.length;
  const start = (params.page - 1) * params.limit;
  const data = all.slice(start, start + params.limit);
  return res.json(buildPageResponse(req, data, total, params));
});

/**
 * @openapi
 * /audit/resource/{type}/{id}:
 *   get:
 *     tags: [Audit]
 *     summary: List audit log entries for a specific resource
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Audit log entries for the resource
 */
router.get('/resource/:type/:id', authMiddleware, (req: Request, res: Response) => {
  return res.json(AuditLogStore.forResource(req.params.type, req.params.id));
});

export default router;
