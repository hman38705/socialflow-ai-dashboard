import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthBlacklistService } from '../services/AuthBlacklistService';
import { config } from '../config/config';

export interface AuthRequest extends Request {
  user?: { id: string };
  activeOrgId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ message: 'Invalid or expired access token' });
    return;
  }

  const tokenKey = AuthBlacklistService.keyFromPayload(payload);
  if (await AuthBlacklistService.isBlacklisted(tokenKey)) {
    res.status(401).json({ message: 'Token has been revoked' });
    return;
  }

  req.user = { id: payload.sub as string };
  next();
}
