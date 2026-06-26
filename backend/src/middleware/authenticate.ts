import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthBlacklistService } from '../services/AuthBlacklistService';
import { config } from '../config/config';

export interface AuthRequest extends Request {
  user?: { id: string };
  activeOrgId?: string;
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);

  // Short-circuit: decode without verification to check expiry before touching Redis.
  // This avoids a round-trip to the blacklist store for tokens that are already expired.
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (!decoded || (typeof decoded.exp === 'number' && decoded.exp * 1000 < Date.now())) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const tokenKey = AuthBlacklistService.keyFromPayload(payload);
  if (await AuthBlacklistService.isBlacklisted(tokenKey)) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const userId = payload.sub as string;
  req.user = { id: userId };
  next();
}
