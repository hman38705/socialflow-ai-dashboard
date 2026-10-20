import { Request, Response, NextFunction } from 'express';
import { auditLogger } from '../services/AuditLogger';
import { AuditAction } from '../models/AuditLog';

/**
 * Records an audit event for an admin mutation once the response is sent.
 * Captures actor, IP, params (redacted by auditLogger) and outcome.
 */
export function auditAdmin(action: AuditAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.on('finish', () => {
      void auditLogger.log({
        actorId: (req as Request & { user?: { id: string } }).user?.id ?? 'unknown',
        action,
        resourceType: 'admin',
        resourceId: req.params?.name ?? req.params?.key ?? req.params?.service,
        metadata: {
          body: req.body,
          params: req.params,
          statusCode: res.statusCode,
          outcome: res.statusCode < 400 ? 'success' : 'failure',
        },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    });
    next();
  };
}
