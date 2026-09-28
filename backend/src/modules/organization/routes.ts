import { Router } from 'express';
import { authenticate } from '../auth/middleware/authMiddleware';
import * as organizationController from './controllers/organization';

const router = Router();

router.use(authenticate);

router.get('/', organizationController.listOrganizations);
router.get('/:id', organizationController.getOrganization);
router.post('/', organizationController.createOrganization);
router.put('/:id', organizationController.updateOrganization);
router.delete('/:id', organizationController.deleteOrganization);

export default router;
