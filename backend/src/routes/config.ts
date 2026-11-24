import { Router, Request, Response } from 'express';
import { getDynamicConfigService, ConfigType, ConfigKey } from '../services/DynamicConfigService';
import { authMiddleware } from '../middleware/authMiddleware';
import { checkPermission } from '../middleware/checkPermission';
import { auditLogger } from '../services/auditLogger';

const router = Router();

const KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const ALLOWED_KEYS = new Set<string>(Object.values(ConfigKey));
const SENSITIVE_KEY_PATTERN = /(secret|token|password|passwd|api[_.-]?key|private|credential|auth)/i;
const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;

function validateValue(value: unknown, type: ConfigType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length <= 4096;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'json':
      try {
        return JSON.stringify(value).length <= 65536;
      } catch {
        return false;
      }
  }
}

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
      configs[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : svc.get(key);
    }

    res.json({
      success: true,
      status,
      configs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
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
    res.status(500).json({ success: false, message: 'Internal server error' });
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
  const actorId = req.user?.id;
  const configType: ConfigType = type === undefined ? 'string' : type;

  const recordFailure = async (message: string) => {
    try {
      await auditLogger.log({
        actorId,
        action: 'admin:config:update',
        resourceType: 'config',
        resourceId: key,
        outcome: 'failure',
        metadata: { key, type: configType, error: message },
      });
    } catch {
      // Audit failures must not mask the original error response.
    }
  };

  if (!KEY_PATTERN.test(key) || !ALLOWED_KEYS.has(key)) {
    const message = 'Invalid or unsupported config key';
    await recordFailure(message);
    return res.status(400).json({ success: false, message });
  }
  if (value === undefined) {
    const message = 'Value is required';
    await recordFailure(message);
    return res.status(400).json({ success: false, message });
  }
  if (!CONFIG_TYPES.includes(configType)) {
    const message = 'Invalid config type';
    await recordFailure(message);
    return res.status(400).json({ success: false, message });
  }
  if (!validateValue(value, configType)) {
    const message = `Value does not match type "${configType}"`;
    await recordFailure(message);
    return res.status(400).json({ success: false, message });
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    const message = 'Invalid description';
    await recordFailure(message);
    return res.status(400).json({ success: false, message });
  }

  try {
    const svc = await getDynamicConfigService();
    await svc.set(key, value, configType, description);
    await auditLogger.log({
      actorId,
      action: 'admin:config:update',
      resourceType: 'config',
      resourceId: key,
      outcome: 'success',
      metadata: { key, type: configType },
    });
    res.json({ success: true, message: `Configuration "${key}" updated successfully` });
  } catch (error) {
    await recordFailure(error instanceof Error ? error.message : 'Internal server error');
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
