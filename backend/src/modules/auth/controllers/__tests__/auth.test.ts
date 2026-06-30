import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const mockUserStore = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockAuditLogger = { log: jest.fn() };

jest.mock('../../../../models/User', () => ({ UserStore: mockUserStore }));
jest.mock('../../../../services/AuditLogger', () => ({ auditLogger: mockAuditLogger }));
jest.mock('../../../../config/config', () => ({
  config: {
    JWT_SECRET: 'test-access-secret-at-least-32-characters-long',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
    JWT_REFRESH_EXPIRES_IN: '7d',
  },
}));
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (pw: string) => `hashed:${pw}`),
  compare: jest.fn(async (pw: string, hash: string) => hash === `hashed:${pw}`),
}));

import { register, login, refresh, logout } from '../auth';

function mockRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function mockReq(body: Record<string, unknown>): Request {
  return { body, ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;
}

const ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
const REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

function signRefreshFor(userId: string): string {
  return jwt.sign({ sub: userId, jti: 'fixed-jti' }, REFRESH_SECRET, { expiresIn: '7d' });
}

describe('auth controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('creates a user and returns a token pair when the email is free', async () => {
      mockUserStore.findByEmail.mockResolvedValue(null);
      mockUserStore.create.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: 'hashed:secret123',
        createdAt: new Date(),
        refreshTokens: [],
      });
      mockUserStore.update.mockResolvedValue(null);
      const res = mockRes();

      await register(mockReq({ email: 'a@b.com', password: 'secret123' }), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(jwt.verify(body.accessToken, ACCESS_SECRET)).toMatchObject({ sub: 'user-1' });
      expect(mockUserStore.update).toHaveBeenCalledWith('user-1', {
        refreshTokens: [body.refreshToken],
      });
    });

    it('returns 409 without creating a user when the email is already registered', async () => {
      mockUserStore.findByEmail.mockResolvedValue({ id: 'existing' });
      const res = mockRes();

      await register(mockReq({ email: 'a@b.com', password: 'secret123' }), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUserStore.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a token pair and appends the refresh token for valid credentials', async () => {
      mockUserStore.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: 'hashed:secret123',
        refreshTokens: ['old-token'],
      });
      mockUserStore.update.mockResolvedValue(null);
      const res = mockRes();

      await login(mockReq({ email: 'a@b.com', password: 'secret123' }), res);

      expect(res.status).not.toHaveBeenCalled();
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.accessToken).toBeDefined();
      expect(mockUserStore.update).toHaveBeenCalledWith('user-1', {
        refreshTokens: ['old-token', body.refreshToken],
      });
    });

    it('returns 401 for an unknown email', async () => {
      mockUserStore.findByEmail.mockResolvedValue(null);
      const res = mockRes();

      await login(mockReq({ email: 'nobody@b.com', password: 'x' }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
    });

    it('returns 401 for a wrong password without touching the store', async () => {
      mockUserStore.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'hashed:secret123',
        refreshTokens: [],
      });
      const res = mockRes();

      await login(mockReq({ email: 'a@b.com', password: 'wrong' }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockUserStore.update).not.toHaveBeenCalled();
    });
  });

  describe('refresh — token rotation', () => {
    it('issues a new refresh token and invalidates the old one', async () => {
      const oldRefresh = signRefreshFor('user-1');
      mockUserStore.findById.mockResolvedValue({
        id: 'user-1',
        refreshTokens: [oldRefresh, 'other-device-token'],
      });
      mockUserStore.update.mockResolvedValue(null);
      const res = mockRes();

      await refresh(mockReq({ refreshToken: oldRefresh }), res);

      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.refreshToken).toBeDefined();
      expect(body.refreshToken).not.toBe(oldRefresh);
      expect(jwt.verify(body.accessToken, ACCESS_SECRET)).toMatchObject({ sub: 'user-1' });

      // Old token is dropped from the persisted set; other sessions are preserved.
      const updateArgs = mockUserStore.update.mock.calls[0][1];
      expect(updateArgs.refreshTokens).toContain('other-device-token');
      expect(updateArgs.refreshTokens).toContain(body.refreshToken);
      expect(updateArgs.refreshTokens).not.toContain(oldRefresh);
    });

    it('rejects a malformed or expired refresh token', async () => {
      const res = mockRes();

      await refresh(mockReq({ refreshToken: 'not-a-real-jwt' }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired refresh token' });
      expect(mockUserStore.findById).not.toHaveBeenCalled();
    });

    it('rejects a structurally valid token that has already been revoked', async () => {
      const revokedToken = signRefreshFor('user-1');
      mockUserStore.findById.mockResolvedValue({ id: 'user-1', refreshTokens: ['some-other-token'] });
      const res = mockRes();

      await refresh(mockReq({ refreshToken: revokedToken }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Refresh token revoked' });
      expect(mockUserStore.update).not.toHaveBeenCalled();
    });

    it('rejects a refresh token for a user that no longer exists', async () => {
      mockUserStore.findById.mockResolvedValue(null);
      const res = mockRes();

      await refresh(mockReq({ refreshToken: signRefreshFor('ghost-user') }), res);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('logout — session invalidation', () => {
    it('removes only the presented refresh token and logs the action', async () => {
      const target = signRefreshFor('user-1');
      mockUserStore.findById.mockResolvedValue({
        id: 'user-1',
        refreshTokens: [target, 'keep-me'],
      });
      mockUserStore.update.mockResolvedValue(null);
      const res = mockRes();

      await logout(mockReq({ refreshToken: target }), res);

      expect(mockUserStore.update).toHaveBeenCalledWith('user-1', { refreshTokens: ['keep-me'] });
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-1', action: 'auth:logout' }),
      );
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('returns 401 for an invalid token without touching the store', async () => {
      const res = mockRes();

      await logout(mockReq({ refreshToken: 'garbage' }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockUserStore.update).not.toHaveBeenCalled();
    });

    it('still responds 204 when the token is well-formed but the user is gone', async () => {
      mockUserStore.findById.mockResolvedValue(null);
      const res = mockRes();

      await logout(mockReq({ refreshToken: signRefreshFor('ghost-user') }), res);

      expect(mockUserStore.update).not.toHaveBeenCalled();
      expect(mockAuditLogger.log).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });
});
