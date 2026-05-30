import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = () => process.env.JWT_SECRET ?? 'change-me-in-production';

export interface AuthRequest extends Request {
  user?: { id: string };
  activeOrgId?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET()) as jwt.JwtPayload;
    req.user = { id: payload.sub as string };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired access token' });
  }
}
