import { Router, Request, Response } from 'express';
import { getDynamicConfigService, ConfigType } from '../services/DynamicConfigService';
import { authMiddleware } from '../middleware/authMiddleware';
import { checkPermission } from '../middleware/checkPermission';

const router = Router();

/**
 * @route GET /api/config
 * @desc Get all configuration values from cache
 * @access Private/Admin
 */
router.get('/', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  try {
    const svc = await getDynamicConfigService();
    const status = svc.getStatus();
    const configs: Record<string, any> = {};

    for (const key of status.cachedKeys) {
      configs[key] = svc.get(key);
    }

    res.json({
      success: true,
      status,
      configs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

/**
 * @route POST /api/config/refresh
 * @desc Manually refresh the configuration cache from the database
 * @access Private/Admin
 */
router.post('/refresh', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  try {
    const svc = await getDynamicConfigService();
    await svc.refreshCache();
    res.json({ success: true, message: 'Configuration cache refreshed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

/**
 * @route PUT /api/config/:key
 * @desc Update or create a configuration value
 * @access Private/Admin
 */
router.put('/:key', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  const { key } = req.params;
  const { value, type, description } = req.body;

  if (value === undefined) {
    return res.status(400).json({ success: false, message: 'Value is required' });
  }

  try {
    const svc = await getDynamicConfigService();
    await svc.set(key, value, type as ConfigType, description);
    res.json({ success: true, message: `Configuration "${key}" updated successfully` });
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

export default router;
