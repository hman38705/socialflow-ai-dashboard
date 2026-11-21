/**
 * Admin routes RBAC — non-admin users must receive 403
 */
import request from 'supertest';
import express from 'express';

// Mock authenticate to inject a user id
jest.mock('../middleware/authenticate', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: req.headers['x-test-user-id'] || 'anon' };
    next();
  },
}));

// Mock admin services so routes don't need real Redis
jest.mock('../admin/jobAdminService', () => ({
  getDiscoveredQueueNames: jest.fn().mockResolvedValue([]),
  retryFailedJobs: jest.fn().mockResolvedValue({}),
}));
jest.mock('../admin/cacheAdminService', () => ({
  clearCache: jest.fn().mockResolvedValue({}),
}));
jest.mock('../admin/migrationService', () => ({
  listMigrations: jest.fn().mockResolvedValue([]),
  runMigrations: jest.fn().mockResolvedValue({}),
  rollbackMigration: jest.fn().mockResolvedValue({ success: true }),
}));

// Mock the audit logger consistently with audit.test.ts so we can assert
// that config mutations are recorded in the audit trail.
jest.mock('../services/auditLogService', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

import { RoleStore } from '../models/Role';
import adminRouter from '../routes/admin';
import { logAuditEvent } from '../services/auditLogService';
import { retryFailedJobs } from '../admin/jobAdminService';
import { MAX_BATCH_SIZE, DEFAULT_LIMIT } from '../admin/constants';
import { runMigrations, rollbackMigration } from '../admin/migrationService';

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);

// Integration harness: mount the router at the real production path so the
// test exercises the same HTTP surface the running app exposes.
const mountedApp = express();
mountedApp.use(express.json());
mountedApp.use('/api/admin', adminRouter);

const ADMIN_ENDPOINTS = [
  { method: 'get', path: '/admin/jobs/queues' },
  { method: 'post', path: '/admin/jobs/retry' },
  { method: 'post', path: '/admin/cache/clear' },
  { method: 'get', path: '/admin/migrations' },
  { method: 'post', path: '/admin/migrations/run' },
  { method: 'post', path: '/admin/migrations/test/rollback' },
];

describe('Admin routes RBAC', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    RoleStore.assign('editor-user', 'editor');
  });

  it.each(ADMIN_ENDPOINTS)(
    'non-admin user receives 403 on $method $path',
    async ({ method, path }) => {
      const res = await (request(app) as any)
        [method](path)
        .set('x-test-user-id', 'editor-user')
        .send({});
      expect(res.status).toBe(403);
    },
  );

  it('admin user can access GET /admin/jobs/queues', async () => {
    const res = await request(app)
      .get('/admin/jobs/queues')
      .set('x-test-user-id', 'admin-user');
    expect(res.status).toBe(200);
  });

  it('admin user can access GET /admin/migrations', async () => {
    const res = await request(app)
      .get('/admin/migrations')
      .set('x-test-user-id', 'admin-user');
    expect(res.status).toBe(200);
  });
});

describe('Admin routes mounted at /api/admin', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    RoleStore.assign('editor-user', 'editor');
  });

  it('requires users:manage permission on GET /api/admin/jobs/queues', async () => {
    const res = await request(mountedApp)
      .get('/api/admin/jobs/queues')
      .set('x-test-user-id', 'editor-user');
    expect(res.status).toBe(403);
  });

  it('returns queue data for an authorized caller on GET /api/admin/jobs/queues', async () => {
    const res = await request(mountedApp)
      .get('/api/admin/jobs/queues')
      .set('x-test-user-id', 'admin-user');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

describe('Admin config audit logging', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    (logAuditEvent as jest.Mock).mockClear();
  });

  it('writes an audit log entry capturing the changed key and acting admin on config PUT', async () => {
    const res = await request(app)
      .put('/admin/config')
      .set('x-test-user-id', 'admin-user')
      .send({ key: 'featureFlags.newDashboard', value: true });

    expect(res.status).toBeLessThan(400);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);

    const entry = (logAuditEvent as jest.Mock).mock.calls[0][0];
    expect(entry).toEqual(
      expect.objectContaining({
        actorId: 'admin-user',
        action: expect.stringMatching(/config/i),
      }),
    );
    expect(JSON.stringify(entry)).toContain('featureFlags.newDashboard');
  });
});

describe('Admin numeric input validation', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    (retryFailedJobs as jest.Mock).mockClear();
  });

  it('rejects a non-numeric limit with a 400', async () => {
    const res = await request(app)
      .get('/admin/jobs/queues')
      .query({ limit: 'not-a-number' })
      .set('x-test-user-id', 'admin-user');

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('rejects a non-numeric batchSize with a 400', async () => {
    const res = await request(app)
      .post('/admin/jobs/retry')
      .set('x-test-user-id', 'admin-user')
      .send({ batchSize: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(retryFailedJobs).not.toHaveBeenCalled();
  });

  it('enforces the upper bound on batchSize', async () => {
    const res = await request(app)
      .post('/admin/jobs/retry')
      .set('x-test-user-id', 'admin-user')
      .send({ batchSize: MAX_BATCH_SIZE + 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(retryFailedJobs).not.toHaveBeenCalled();
  });

  it('applies the default limit when omitted', async () => {
    const res = await request(app)
      .get('/admin/jobs/queues')
      .set('x-test-user-id', 'admin-user');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

describe('Admin batchSize upper bound', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    jest.clearAllMocks();
  });

  it('rejects batchSize above the maximum with a 400 naming batchSize', async () => {
    const res = await request(app)
      .post('/admin/cache/clear')
      .set('x-test-user-id', 'admin-user')
      .send({ pattern: 'user:*', batchSize: MAX_BATCH_SIZE + 1 });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === 'batchSize')).toBe(true);
  });

  it('accepts batchSize exactly at the maximum', async () => {
    const res = await request(app)
      .post('/admin/cache/clear')
      .set('x-test-user-id', 'admin-user')
      .send({ pattern: 'user:*', batchSize: MAX_BATCH_SIZE });

    expect(res.status).not.toBe(400);
  });
});

describe('Admin limit default', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    jest.clearAllMocks();
  });

  it('returns the documented default number of rows when limit is omitted', async () => {
    const rows = Array.from({ length: DEFAULT_LIMIT + 1 }, (_, i) => ({ id: i }));
    (retryFailedJobs as jest.Mock).mockResolvedValueOnce({ processed: rows });

    const res = await request(app)
      .post('/admin/jobs/retry')
      .set('x-test-user-id', 'admin-user')
      .send({});

    expect(res.status).toBe(200);
    const returned = res.body.processed ?? res.body;
    expect(returned.length).toBe(DEFAULT_LIMIT);
  });

  it('lets an explicit limit override the default', async () => {
    const rows = Array.from({ length: DEFAULT_LIMIT + 1 }, (_, i) => ({ id: i }));
    (retryFailedJobs as jest.Mock).mockResolvedValueOnce({ processed: rows });

    const res = await request(app)
      .post('/admin/jobs/retry')
      .set('x-test-user-id', 'admin-user')
      .send({ limit: 1 });

    expect(res.status).toBe(200);
    const returned = res.body.processed ?? res.body;
    expect(returned.length).toBe(1);
  });
});

describe('Admin force flag rejection', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    jest.clearAllMocks();
  });

  it('rejects force as a string on /admin/migrations/run with a 400 naming force', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({ force: 'false' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === 'force')).toBe(true);
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('rejects force as a number on /admin/migrations/run with a 400 naming force', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({ force: 1 });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === 'force')).toBe(true);
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('rejects force as a string on the rollback route with a 400 naming force', async () => {
    const res = await request(app)
      .post('/admin/migrations/test/rollback')
      .set('x-test-user-id', 'admin-user')
      .send({ force: 'false' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === 'force')).toBe(true);
    expect(rollbackMigration).not.toHaveBeenCalled();
  });

  it('rejects force as a number on the rollback route with a 400 naming force', async () => {
    const res = await request(app)
      .post('/admin/migrations/test/rollback')
      .set('x-test-user-id', 'admin-user')
      .send({ force: 1 });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === 'force')).toBe(true);
    expect(rollbackMigration).not.toHaveBeenCalled();
  });
});

describe('Admin dryRun flag validation', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    jest.clearAllMocks();
  });

  it('rejects dryRun as a string with a 400 naming dryRun', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({ dryRun: 'true' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === 'dryRun')).toBe(true);
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('applies the documented default when dryRun is omitted', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({});

    expect(res.status).not.toBe(400);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    const callArg = (runMigrations as jest.Mock).mock.calls[0][0];
    expect(callArg?.dryRun ?? false).toBe(false);
  });
});
