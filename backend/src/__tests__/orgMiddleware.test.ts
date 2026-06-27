import { Response, NextFunction } from 'express';
import { orgMiddleware } from '../middleware/orgMiddleware';
import { AuthRequest } from '../middleware/authMiddleware';

const mockFindUnique = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    organizationMember: { findUnique: mockFindUnique },
  },
}));

function makeReq(orgId?: string, userId = 'user-1'): AuthRequest {
  return {
    headers: orgId ? { 'x-org-id': orgId } : {},
    user: { id: userId },
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

beforeEach(() => {
  mockFindUnique.mockReset();
});

describe('orgMiddleware', () => {
  describe('missing-header rejection', () => {
    it('responds 400 when x-org-id header is absent', async () => {
      const req = makeReq(undefined);
      const res = makeRes();
      const next = jest.fn();

      await orgMiddleware(req, res as Response, next as NextFunction);

      expect(res.getStatus()).toBe(400);
      expect(res.getBody()).toEqual({ message: 'Missing x-org-id header' });
    });

    it('does not call next() when x-org-id header is missing', async () => {
      const req = makeReq(undefined);
      const res = makeRes();
      const next = jest.fn();

      await orgMiddleware(req, res as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('org context injection', () => {
    it('sets req.activeOrgId and calls next when user is a member', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: 'org-1', userId: 'user-1' });
      const req = makeReq('org-1');
      const res = makeRes();
      const next = jest.fn();

      await orgMiddleware(req, res as Response, next as NextFunction);

      expect(req.activeOrgId).toBe('org-1');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('queries membership with the correct compound key', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: 'org-42', userId: 'user-99' });
      const req = makeReq('org-42', 'user-99');
      const res = makeRes();

      await orgMiddleware(req, res as Response, jest.fn() as NextFunction);

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: {
          organizationId_userId: { organizationId: 'org-42', userId: 'user-99' },
        },
      });
    });

    it('does not set activeOrgId when membership check fails', async () => {
      mockFindUnique.mockResolvedValue(null);
      const req = makeReq('org-1');
      const res = makeRes();

      await orgMiddleware(req, res as Response, jest.fn() as NextFunction);

      expect(req.activeOrgId).toBeUndefined();
    });
  });

  describe('tenant isolation', () => {
    it('responds 403 when user is not a member of the org', async () => {
      mockFindUnique.mockResolvedValue(null);
      const req = makeReq('org-1');
      const res = makeRes();
      const next = jest.fn();

      await orgMiddleware(req, res as Response, next as NextFunction);

      expect(res.getStatus()).toBe(403);
      expect(res.getBody()).toEqual({ message: 'Not a member of this organization' });
      expect(next).not.toHaveBeenCalled();
    });

    it('member of org-A cannot access org-B context', async () => {
      mockFindUnique.mockImplementation(({ where }: any) => {
        const { organizationId, userId } = where.organizationId_userId;
        if (organizationId === 'org-A' && userId === 'user-1') {
          return Promise.resolve({ organizationId: 'org-A', userId: 'user-1' });
        }
        return Promise.resolve(null);
      });

      const req = makeReq('org-B', 'user-1');
      const res = makeRes();
      const next = jest.fn();

      await orgMiddleware(req, res as Response, next as NextFunction);

      expect(res.getStatus()).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('two different users get isolated org contexts', async () => {
      mockFindUnique.mockImplementation(({ where }: any) => {
        const { organizationId, userId } = where.organizationId_userId;
        if (organizationId === 'org-1' && userId === 'user-A') {
          return Promise.resolve({ organizationId: 'org-1', userId: 'user-A' });
        }
        return Promise.resolve(null);
      });

      const reqA = makeReq('org-1', 'user-A');
      const reqB = makeReq('org-1', 'user-B');
      const resA = makeRes();
      const resB = makeRes();
      const nextA = jest.fn();
      const nextB = jest.fn();

      await orgMiddleware(reqA, resA as Response, nextA as NextFunction);
      await orgMiddleware(reqB, resB as Response, nextB as NextFunction);

      expect(reqA.activeOrgId).toBe('org-1');
      expect(nextA).toHaveBeenCalledTimes(1);
      expect(resB.getStatus()).toBe(403);
      expect(nextB).not.toHaveBeenCalled();
    });
  });
});
