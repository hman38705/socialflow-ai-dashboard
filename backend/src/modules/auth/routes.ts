import { Router } from 'express';
import { register, login, refresh, logout, changePassword } from './controllers/auth';
import { validate } from '../../middleware/validate';
import { credentialsSchema, refreshTokenSchema, changePasswordSchema } from '../../schemas/auth';
import { authenticate, AuthRequest } from '../../middleware/authenticate';
import { sseTicketService } from '../../services/SSETicketService';
import { loginRegisterLimiter, refreshLimiter } from '../../shared/middleware/authRateLimiters';

const router = Router();

router.post('/register', loginRegisterLimiter, validate(credentialsSchema), register);
router.post('/login', loginRegisterLimiter, validate(credentialsSchema), login);
router.post('/refresh', refreshLimiter, validate(refreshTokenSchema), refresh);
router.post('/logout', validate(refreshTokenSchema), logout);
router.post('/change-password', authenticate, validate(changePasswordSchema), changePassword);
router.post('/sse-ticket', authenticate, (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const ticket = sseTicketService.generateTicket(userId);
  res.status(200).json({ ticket, expiresIn: 30 });
});

export default router;
