import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { UserStore } from '../../../models/User';
import { auditLogger } from '../../../services/AuditLogger';
import { config } from '../../../config/config';

const SALT_ROUNDS = 12;

const jwtSecret = () => config.JWT_SECRET;
const jwtExpiresIn = () => config.JWT_EXPIRES_IN;
const jwtRefreshSecret = () => config.JWT_REFRESH_SECRET;
const jwtRefreshExpiresIn = () => config.JWT_REFRESH_EXPIRES_IN;

function signAccess(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: jwtExpiresIn() } as jwt.SignOptions);
}

function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId, jti: randomUUID() }, jwtRefreshSecret(), {
    expiresIn: jwtRefreshExpiresIn(),
  } as jwt.SignOptions);
}

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };

  if (await UserStore.findByEmail(email)) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await UserStore.create({
    id: randomUUID(),
    email,
    passwordHash,
    createdAt: new Date(),
    refreshTokens: [],
  });

  const accessToken = signAccess(user.id);
  const refreshToken = signRefresh(user.id);
  await UserStore.update(user.id, { refreshTokens: [refreshToken] });

  auditLogger.log({
    actorId: user.id,
    action: 'auth:register',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.status(201).json({ accessToken, refreshToken });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };

  const user = await UserStore.findByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const accessToken = signAccess(user.id);
  const refreshToken = signRefresh(user.id);
  await UserStore.update(user.id, { refreshTokens: [...user.refreshTokens, refreshToken] });

  auditLogger.log({
    actorId: user.id,
    action: 'auth:login',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  res.json({ accessToken, refreshToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(refreshToken, jwtRefreshSecret()) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ message: 'Invalid or expired refresh token' });
    return;
  }

  const user = await UserStore.findById(payload.sub as string);
  if (!user || !user.refreshTokens.includes(refreshToken)) {
    res.status(401).json({ message: 'Refresh token revoked' });
    return;
  }

  // Rotate refresh token
  const newRefresh = signRefresh(user.id);
  await UserStore.update(user.id, {
    refreshTokens: [...user.refreshTokens.filter((t) => t !== refreshToken), newRefresh],
  });

  res.json({ accessToken: signAccess(user.id), refreshToken: newRefresh });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(refreshToken, jwtRefreshSecret()) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }

  const user = await UserStore.findById(payload.sub as string);
  if (user) {
    await UserStore.update(user.id, {
      refreshTokens: user.refreshTokens.filter((t) => t !== refreshToken),
    });
    auditLogger.log({
      actorId: user.id,
      action: 'auth:logout',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  res.status(204).send();
}
