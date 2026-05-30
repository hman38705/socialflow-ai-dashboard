import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { auditLogger } from '../services/AuditLogger';
import { AuditAction } from '../models/AuditLog';
import { redactSensitiveFields } from '../utils/redactSensitiveFields';

/**
 * Middleware factory that records an audit log entry after the response is sent.
 * Must be used after `authMiddleware` (requires req.user.id).
 *
 * Sensitive fields (password, token, cardNumber, cvv, secret) are automatically
 * redacted from any metadata before it is written to the audit log.
 *
 * Usage:
 *   router.delete('/:id', authMiddleware, audit('post:delete', 'post', (req) => req.params.id), handler)
 *
 *   // With metadata (body fields are redacted automatically):
 *   router.post('/login', audit('auth:login', undefined, undefined, (req) => req.body), handler)
 */
export function audit(
  action: AuditAction,
  resourceType?: string,
  resourceId?: (req: AuthRequest) => string | undefined,
  metadata?: (req: AuthRequest) => Record<string, unknown> | undefined,
) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      // Only log on successful (2xx) responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const rawMetadata = metadata?.(req);
        const enrichedMetadata: Record<string, unknown> = {
          ...(rawMetadata ?? {}),
          ...(req.activeOrgId ? { orgId: req.activeOrgId } : {}),
        };
        auditLogger.log({
          actorId: req.user?.id ?? 'anonymous',
          action,
          organizationId: req.activeOrgId,
          resourceType,
          resourceId: resourceId?.(req),
          metadata: redactSensitiveFields(enrichedMetadata),
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    });
    next();
  };
}
