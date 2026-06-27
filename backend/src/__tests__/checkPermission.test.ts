import { Response, NextFunction } from 'express';
import { checkPermission } from '../middleware/checkPermission';
import { AuthRequest } from '../middleware/authenticate';
import { RoleStore } from '../models/Role';

function makeReq(userId?: string): AuthRequest {
  return {
    user: userId ? { id: userId } : undefined,
  } as unknown as AuthRequest;
}

function makeRes() {
  let statusCode: number;
  let body: unknown;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body,
  };
  return res;
}

let hasPermSpy: jest.SpyInstance;

beforeEach(() => {
  hasPermSpy = jest.spyOn(RoleStore, 'hasPermission');
});

afterEach(() => {
  hasPermSpy.mockRestore();
});

describe('checkPermission middleware', () => {
  describe('role-based access', () => {
    it('calls next() when user has the required permission', () => {
      hasPermSpy.mockReturnValue(true);
      const mw = checkPermission('posts:create');
      const req = makeReq('user-1');
      const res = makeRes();
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('admin with all permissions passes any single-permission check', () => {
      hasPermSpy.mockReturnValue(true);
      const permissions = ['posts:create', 'posts:delete', 'users:manage', 'roles:manage'] as const;

      for (const perm of permissions) {
        const mw = checkPermission(perm);
        const req = makeReq('user-admin');
        const res = makeRes();
        const next = jest.fn();

        mw(req, res as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
      }
    });

    it('passes when all required permissions are present', () => {
      hasPermSpy.mockReturnValue(true);
      const mw = checkPermission('posts:create', 'posts:read');
      const req = makeReq('user-1');
      const res = makeRes();
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('403 response shape', () => {
    it('responds 403 when the user lacks a required permission', () => {
      hasPermSpy.mockReturnValue(false);
      const mw = checkPermission('users:manage');
      const req = makeReq('user-viewer');
      const res = makeRes();
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(res.getStatus()).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('403 body includes message and missing array', () => {
      hasPermSpy.mockReturnValue(false);
      const mw = checkPermission('users:manage');
      const req = makeReq('user-viewer');
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      expect(res.getBody()).toEqual({ message: 'Forbidden', missing: ['users:manage'] });
    });

    it('missing array contains only the permissions the user lacks', () => {
      hasPermSpy.mockImplementation((_userId, perm) => perm === 'posts:create');
      const mw = checkPermission('posts:create', 'users:manage', 'roles:manage');
      const req = makeReq('user-editor');
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const body = res.getBody() as { missing: string[] };
      expect(body.missing).toEqual(expect.arrayContaining(['users:manage', 'roles:manage']));
      expect(body.missing).not.toContain('posts:create');
    });

    it('missing array contains all permissions when user has none', () => {
      hasPermSpy.mockReturnValue(false);
      const mw = checkPermission('posts:create', 'users:manage');
      const req = makeReq('user-1');
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const body = res.getBody() as { missing: string[] };
      expect(body.missing).toHaveLength(2);
    });
  });

  describe('org membership check', () => {
    it('responds 401 when no user is attached to the request', () => {
      const mw = checkPermission('posts:create');
      const req = makeReq(undefined);
      const res = makeRes();
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(res.getStatus()).toBe(401);
      expect(res.getBody()).toEqual({ message: 'Unauthorized' });
      expect(next).not.toHaveBeenCalled();
    });

    it('does not call hasPermission when user is missing', () => {
      const mw = checkPermission('posts:create');
      const req = makeReq(undefined);
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      expect(hasPermSpy).not.toHaveBeenCalled();
    });

    it('checks permission against the authenticated user id', () => {
      hasPermSpy.mockReturnValue(true);
      const mw = checkPermission('posts:read');
      const req = makeReq('user-abc');
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      expect(hasPermSpy).toHaveBeenCalledWith('user-abc', 'posts:read');
    });
  });
});
