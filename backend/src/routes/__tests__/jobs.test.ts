import express from 'express';
import request from 'supertest';

// Mock the auth middleware and permission check so we can exercise the route
// handlers in isolation and control the authenticated caller per test.
const mockAuthMiddleware = jest.fn((req: any, _res: any, next: any) => {
  req.user = { id: 'user-1', orgId: 'org-1' };
  next();
});
const mockCheckPermission = jest.fn((_req: any, _res: any, next: any) => next());

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => mockAuthMiddleware(req, res, next),
}));

jest.mock('../../middleware/permissions', () => ({
  checkPermission: (...args: any[]) => (mockCheckPermission as any)(...args),
}));

// Mock the job monitor so tests do not depend on real job state.
const mockListJobs = jest.fn();
const mockGetJob = jest.fn();

jest.mock('../../services/jobMonitor', () => ({
  jobMonitor: {
    listJobs: (...args: any[]) => mockListJobs(...args),
    getJob: (...args: any[]) => mockGetJob(...args),
  },
}));

import jobsRouter from '../jobs';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/jobs', jobsRouter);
  return app;
}

describe('jobs routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthMiddleware.mockImplementation((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', orgId: 'org-1' };
      next();
    });
    mockCheckPermission.mockImplementation((_req: any, _res: any, next: any) => next());
  });

  describe('GET /jobs (listing)', () => {
    it('returns the jobs for the authenticated caller', async () => {
      mockListJobs.mockResolvedValue([
        { id: 'job-1', ownerId: 'user-1', orgId: 'org-1', status: 'completed' },
      ]);

      const res = await request(buildApp()).get('/jobs');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 'job-1', ownerId: 'user-1', orgId: 'org-1', status: 'completed' },
      ]);
      expect(mockListJobs).toHaveBeenCalledTimes(1);
    });

    it('rejects the request when the permission check denies access', async () => {
      mockCheckPermission.mockImplementation((_req: any, res: any) => {
        res.status(403).json({ error: 'Forbidden' });
      });

      const res = await request(buildApp()).get('/jobs');

      expect(res.status).toBe(403);
      expect(mockListJobs).not.toHaveBeenCalled();
    });
  });

  describe('GET /jobs/:id (detail lookup)', () => {
    it('returns the job detail for the owning caller', async () => {
      mockGetJob.mockResolvedValue({
        id: 'job-1',
        ownerId: 'user-1',
        orgId: 'org-1',
        status: 'completed',
      });

      const res = await request(buildApp()).get('/jobs/job-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'job-1', ownerId: 'user-1' });
      expect(mockGetJob).toHaveBeenCalledWith('job-1');
    });

    it('returns 404 when the job does not exist', async () => {
      mockGetJob.mockResolvedValue(null);

      const res = await request(buildApp()).get('/jobs/missing');

      expect(res.status).toBe(404);
    });

    it('rejects the request when the permission check denies access', async () => {
      mockCheckPermission.mockImplementation((_req: any, res: any) => {
        res.status(403).json({ error: 'Forbidden' });
      });

      const res = await request(buildApp()).get('/jobs/job-1');

      expect(res.status).toBe(403);
      expect(mockGetJob).not.toHaveBeenCalled();
    });

    it('does not expose a job owned by another user or org', async () => {
      mockGetJob.mockResolvedValue({
        id: 'job-2',
        ownerId: 'user-2',
        orgId: 'org-2',
        status: 'completed',
      });

      const res = await request(buildApp()).get('/jobs/job-2');

      expect(res.status).toBe(404);
      expect(res.body).not.toMatchObject({ ownerId: 'user-2' });
    });
  });
});
