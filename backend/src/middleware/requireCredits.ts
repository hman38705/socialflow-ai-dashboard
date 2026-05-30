import { Response, NextFunction } from 'express';
import { AuthRequest } from './authenticate';
import { billingService } from '../services/BillingService';
import { CreditAction } from '../models/Subscription';

/**
 * Middleware factory that deducts credits before allowing an action.
 * Must be used after `authMiddleware`.
 *
 * Usage:
 *   router.post('/generate', authMiddleware, requireCredits('ai:generate'), handler)
 */
export function requireCredits(action: CreditAction) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    try {
      const balance = billingService.deductCredits(userId, action);
      // Expose remaining balance to downstream handlers
      (req as any).creditsRemaining = balance;
      next();
    } catch (err) {
      const message = (err as Error).message;
      const status = message.includes('Insufficient') ? 402 : 403;
      res.status(status).json({ message });
    }
  };
}
