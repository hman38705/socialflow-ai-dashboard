import { Response, NextFunction } from 'express';
import { audit } from '../middleware/audit';
import { AuthRequest } from '../middleware/authMiddleware';

const mockLog = jest.fn();

jest.mock('../services/AuditLogger', () => ({
  auditLogger: { log: mockLog },
}));

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 'user-1' },
    activeOrgId: undefined,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest/test' },
    ...overrides,
  } as unknown as AuthRequest;
}

function makeRes(statusCode = 200) {
  const listeners: Record<string, (() => void)[]> = {};
  const res: any = {
    statusCode,
    on(event: string, cb: () => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    },
    emit(event: string) {
      listeners[event]?.forEach((cb) => cb());
    },
  };
  return res;
}

beforeEach(() => {
  mockLog.mockReset();
});

describe('audit middleware', () => {
  describe('async flush behavior', () => {
    it('calls next() immediately without waiting for response finish', () => {
      const mw = audit('post:create');
      const req = makeReq();
      const res = makeRes(200);
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(mockLog).not.toHaveBeenCalled();
    });

    it('logs on the finish event for 2xx responses', () => {
      const mw = audit('post:create');
      const req = makeReq();
      const res = makeRes(201);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    it('logs for any 2xx status code', () => {
      const codes = [200, 201, 204];
      for (const code of codes) {
        mockLog.mockReset();
        const mw = audit('post:create');
        const req = makeReq();
        const res = makeRes(code);

        mw(req, res as Response, jest.fn() as NextFunction);
        res.emit('finish');

        expect(mockLog).toHaveBeenCalledTimes(1);
      }
    });

    it('does not log when the response status is 4xx', () => {
      const mw = audit('post:create');
      const req = makeReq();
      const res = makeRes(400);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog).not.toHaveBeenCalled();
    });

    it('does not log when the response status is 5xx', () => {
      const mw = audit('post:create');
      const req = makeReq();
      const res = makeRes(500);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog).not.toHaveBeenCalled();
    });

    it('does not log before the finish event fires', () => {
      const mw = audit('post:create');
      const req = makeReq();
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);

      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe('sensitive field redaction', () => {
    it('redacts password from metadata', () => {
      const mw = audit(
        'auth:login',
        undefined,
        undefined,
        () => ({ email: 'alice@example.com', password: 'secret123' }),
      );
      const req = makeReq();
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      const logged = mockLog.mock.calls[0][0];
      expect(logged.metadata.password).toBe('[REDACTED]');
      expect(logged.metadata.email).toBe('alice@example.com');
    });

    it('redacts token from metadata', () => {
      const mw = audit('auth:login', undefined, undefined, () => ({ token: 'bearer-abc123' }));
      const req = makeReq();
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog.mock.calls[0][0].metadata.token).toBe('[REDACTED]');
    });

    it('redacts cardNumber and cvv from metadata', () => {
      const mw = audit(
        'billing:provision',
        undefined,
        undefined,
        () => ({ cardNumber: '4111111111111111', cvv: '123', amount: 99 }),
      );
      const req = makeReq();
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      const logged = mockLog.mock.calls[0][0];
      expect(logged.metadata.cardNumber).toBe('[REDACTED]');
      expect(logged.metadata.cvv).toBe('[REDACTED]');
      expect(logged.metadata.amount).toBe(99);
    });

    it('redacts secret from metadata', () => {
      const mw = audit('auth:login', undefined, undefined, () => ({ secret: 'mysecretkey' }));
      const req = makeReq();
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog.mock.calls[0][0].metadata.secret).toBe('[REDACTED]');
    });

    it('preserves non-sensitive metadata fields', () => {
      const mw = audit('post:create', 'post', () => 'post-1', () => ({
        title: 'Hello World',
        tags: ['ts', 'node'],
      }));
      const req = makeReq();
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      const logged = mockLog.mock.calls[0][0];
      expect(logged.metadata.title).toBe('Hello World');
      expect(logged.metadata.tags).toEqual(['ts', 'node']);
    });
  });

  describe('org context attachment', () => {
    it('includes orgId in metadata when req.activeOrgId is set', () => {
      const mw = audit('post:create');
      const req = makeReq({ activeOrgId: 'org-abc' });
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      const logged = mockLog.mock.calls[0][0];
      expect(logged.metadata.orgId).toBe('org-abc');
      expect(logged.organizationId).toBe('org-abc');
    });

    it('does not add orgId to metadata when req.activeOrgId is absent', () => {
      const mw = audit('post:create');
      const req = makeReq({ activeOrgId: undefined });
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog.mock.calls[0][0].metadata).not.toHaveProperty('orgId');
    });

    it('logs actorId from req.user.id', () => {
      const mw = audit('post:delete', 'post', () => 'post-5');
      const req = makeReq({ user: { id: 'user-xyz' } });
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog.mock.calls[0][0]).toMatchObject({
        actorId: 'user-xyz',
        action: 'post:delete',
        resourceType: 'post',
        resourceId: 'post-5',
      });
    });

    it('uses "anonymous" as actorId when req.user is undefined', () => {
      const mw = audit('auth:login');
      const req = makeReq({ user: undefined });
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      expect(mockLog.mock.calls[0][0].actorId).toBe('anonymous');
    });

    it('merges org context with custom metadata', () => {
      const mw = audit('post:create', undefined, undefined, () => ({ extra: 'data' }));
      const req = makeReq({ activeOrgId: 'org-merge' });
      const res = makeRes(200);

      mw(req, res as Response, jest.fn() as NextFunction);
      res.emit('finish');

      const logged = mockLog.mock.calls[0][0];
      expect(logged.metadata.extra).toBe('data');
      expect(logged.metadata.orgId).toBe('org-merge');
    });
  });
});
