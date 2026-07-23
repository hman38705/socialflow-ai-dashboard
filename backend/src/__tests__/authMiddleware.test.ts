// #1103 — Unit tests for authMiddleware: JWT signature verification,
// blacklist lookup, and 401 response shape.

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

jest.mock('../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    isBlacklisted: jest.fn().mockResolvedValue(false),
    keyFromPayload: jest.fn().mockReturnValue('mock-key'),
  },
}));

jest.mock('../config/config', () => ({
  config: { JWT_SECRET: 'test-secret-that-is-at-least-32-chars!!' },
}));

import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { AuthBlacklistService } from '../services/AuthBlacklistService';

const SECRET = 'test-secret-that-is-at-least-32-chars!!';

function makeReq(token?: string): AuthRequest {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as AuthRequest;
}

function makeRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

const next = jest.fn() as unknown as NextFunction;

beforeEach(() => jest.clearAllMocks());

describe('authMiddleware — missing / malformed header', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const res = makeRes();
    await authMiddleware(makeReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header does not start with "Bearer "', async () => {
    const req = { headers: { authorization: 'Token abc' } } as AuthRequest;
    const res = makeRes();
    await authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authMiddleware — invalid / expired JWT', () => {
  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ sub: 'u1' }, 'wrong-secret', { expiresIn: '15m' });
    const res = makeRes();
    await authMiddleware(makeReq(token), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired access token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({ sub: 'u2' }, SECRET, { expiresIn: '-1s' });
    const res = makeRes();
    await authMiddleware(makeReq(token), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired access token' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authMiddleware — blacklist lookup', () => {
  it('returns 401 when token is blacklisted', async () => {
    (AuthBlacklistService.isBlacklisted as jest.Mock).mockResolvedValueOnce(true);
    const token = jwt.sign({ sub: 'u3' }, SECRET, { expiresIn: '15m' });
    const res = makeRes();
    await authMiddleware(makeReq(token), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Token has been revoked' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls isBlacklisted with the key derived from the payload', async () => {
    const token = jwt.sign({ sub: 'u4' }, SECRET, { expiresIn: '15m' });
    const res = makeRes();
    await authMiddleware(makeReq(token), res, next);
    expect(AuthBlacklistService.keyFromPayload).toHaveBeenCalledTimes(1);
    expect(AuthBlacklistService.isBlacklisted).toHaveBeenCalledWith('mock-key');
  });
});

describe('authMiddleware — valid token', () => {
  it('sets req.user and calls next() for a valid non-blacklisted token', async () => {
    const token = jwt.sign({ sub: 'u5' }, SECRET, { expiresIn: '15m' });
    const req = makeReq(token);
    const res = makeRes();
    await authMiddleware(req, res, next);
    expect(req.user).toEqual({ id: 'u5' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
