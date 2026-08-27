import { Router } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { audit } from '../middleware/audit';
import {
  createOrganization,
  listOrganizations,
  getOrganization,
  addMember,
  removeMember,
  switchOrganization,
  updateMemberRole,
  updateOrganization,
} from '../controllers/organization';

const router = Router();

// All org routes require authentication
router.use(authMiddleware);

/**
 * @openapi
 * /organizations:
 *   post:
 *     tags: [Organizations]
 *     summary: Create a new organization
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Organization created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Organization'
 *       401:
 *         description: Unauthorized
 *   get:
 *     tags: [Organizations]
 *     summary: List organizations the current user belongs to
 *     responses:
 *       200:
 *         description: Organization list
 */
router.post('/', createOrganization);
router.get('/', listOrganizations);

/**
 * @openapi
 * /organizations/switch:
 *   post:
 *     tags: [Organizations]
 *     summary: Switch the active organization context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [organizationId]
 *             properties:
 *               organizationId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Context switched
 */
router.post('/switch', switchOrganization);

/**
 * @openapi
 * /organizations/{orgId}:
 *   get:
 *     tags: [Organizations]
 *     summary: Get an organization by ID
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Organization details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Organization'
 *       404:
 *         description: Not found
 */
router.get('/:orgId', getOrganization);

/**
 * @openapi
 * /organizations/{orgId}:
 *   patch:
 *     tags: [Organizations]
 *     summary: Update organization settings (name/slug)
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               slug: { type: string }
 *     responses:
 *       200:
 *         description: Organization updated
 *       403:
 *         description: Insufficient permissions
 *       409:
 *         description: Slug already taken
 */
router.patch(
  '/:orgId',
  audit(
    'org:settings:update',
    'organization',
    (req) => req.params.orgId,
    (req) => req.body,
  ),
  updateOrganization,
);

/**
 * @openapi
 * /organizations/{orgId}/members:
 *   post:
 *     tags: [Organizations]
 *     summary: Add a member to an organization
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Member added
 *       404:
 *         description: Organization or user not found
 */
router.post(
  '/:orgId/members',
  audit(
    'org:member:invite',
    'organization-member',
    (req) => req.body?.userId,
    (req) => ({ orgId: req.params.orgId, role: req.body?.role }),
  ),
  addMember,
);

/**
 * @openapi
 * /organizations/{orgId}/members/{userId}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Remove a member from an organization
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Member removed
 *       404:
 *         description: Not found
 */
router.delete(
  '/:orgId/members/:userId',
  audit(
    'org:member:remove',
    'organization-member',
    (req) => req.params.userId,
    (req) => ({ orgId: req.params.orgId }),
  ),
  removeMember,
);

/**
 * @openapi
 * /organizations/{orgId}/members/{userId}:
 *   patch:
 *     tags: [Organizations]
 *     summary: Change a member's role
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *     responses:
 *       200:
 *         description: Role updated
 *       403:
 *         description: Insufficient permissions or would remove the last owner
 *       404:
 *         description: Not found
 */
router.patch(
  '/:orgId/members/:userId',
  audit(
    'org:member:role_change',
    'organization-member',
    (req) => req.params.userId,
    (req) => ({ orgId: req.params.orgId, role: req.body?.role }),
  ),
  updateMemberRole,
);

export default router;
