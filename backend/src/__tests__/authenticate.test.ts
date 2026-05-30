// #616 – Short-circuit blacklist lookup for already-expired JWTs
// Verifies that the authenticate middleware rejects expired tokens without
// querying Redis, and still performs the blacklist check for valid tokens.

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mock AuthBlacklistService before importing the middleware so we can spy on it.
jest.mock('../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    isBlacklisted: jest.fn().mockResolvedValue(false),
    keyFromPayload: jest.fn().mockReturnValue('mock-key'),
  },
}));

// Mock config so the middleware uses our test secret.
jest.mock('../config/config', () => ({
  config: { JWT_SECRET: 'test-secret-that-is-at-least-32-chars!!' },
}));

import { authenticate, AuthRequest } from '../middleware/authenticate';
import { AuthBlacklistService } from '../services/AuthBlacklistService';

const SECRET = 'test-secret-that-is-at-least-32-chars!!';

function makeReq(token?: string): AuthRequest {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as AuthRequest;
}

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Expired token: Redis must NOT be called ──────────────────────────────────

describe('#616 expired token short-circuit', () => {
  it('returns 401 for an already-expired token without calling isBlacklisted', async () => {
    const expiredToken = jwt.sign({ sub: 'user-1' }, SECRET, { expiresIn: '-10s' });

    const req = makeReq(expiredToken);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
    expect(AuthBlacklistService.isBlacklisted).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not call isBlacklisted when exp is in the past by a large margin', async () => {
    // Manually craft a token whose exp is well in the past.
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const expiredToken = jwt.sign({ sub: 'user-2', exp: pastExp }, SECRET);

    const req = makeReq(expiredToken);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(AuthBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });
});

// ─── Valid token: Redis IS called ────────────────────────────────────────────

describe('#616 valid token still checks blacklist', () => {
  it('calls isBlacklisted for a non-expired token', async () => {
    const validToken = jwt.sign({ sub: 'user-3' }, SECRET, { expiresIn: '15m' });

    const req = makeReq(validToken);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(AuthBlacklistService.isBlacklisted).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when a valid token is blacklisted', async () => {
    (AuthBlacklistService.isBlacklisted as jest.Mock).mockResolvedValueOnce(true);

    const validToken = jwt.sign({ sub: 'user-4' }, SECRET, { expiresIn: '15m' });

    const req = makeReq(validToken);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('#616 edge cases', () => {
  it('returns 401 with no Authorization header, without calling isBlacklisted', async () => {
    const req = makeReq();
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(AuthBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });

  it('returns 401 for a malformed token, without calling isBlacklisted', async () => {
    const req = makeReq('not.a.valid.token');
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(AuthBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });

  it('returns 401 for a token signed with the wrong secret, without calling isBlacklisted', async () => {
    const wrongToken = jwt.sign({ sub: 'user-5' }, 'wrong-secret', { expiresIn: '15m' });

    const req = makeReq(wrongToken);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(AuthBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });

  it('sets req.user for a valid, non-blacklisted token', async () => {
    const validToken = jwt.sign({ sub: 'user-6' }, SECRET, { expiresIn: '15m' });

    const req = makeReq(validToken);
    const res = makeRes();

    await authenticate(req, res, next);

    expect(req.user).toEqual({ id: 'user-6' });
    expect(next).toHaveBeenCalled();
  });
});
