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

// Mock the audit logger so we can assert on audit entries without a real store.
jest.mock('../services/auditLog', () => ({
  recordAudit: jest.fn().mockResolvedValue(undefined),
}));

import { recordAudit } from '../services/auditLog';
import { redactSensitive } from '../utils/redaction';

import { RoleStore } from '../models/Role';
import adminRouter from '../routes/admin';

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

describe('Admin config PUT audit logging', () => {
  const mockRecordAudit = recordAudit as jest.Mock;

  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    RoleStore.assign('editor-user', 'editor');
    mockRecordAudit.mockClear();
  });

  it('writes an audit entry capturing the acting admin and changed keys on a successful config PUT', async () => {
    const res = await request(mountedApp)
      .put('/api/admin/config')
      .set('x-test-user-id', 'admin-user')
      .send({ featureFlags: { beta: true }, maxRetries: 5 });

    expect(res.status).toBe(200);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);

    const entry = mockRecordAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorId: 'admin-user',
      action: expect.stringMatching(/config/i),
    });
    expect(entry.changedKeys ?? entry.keys).toEqual(
      expect.arrayContaining(['featureFlags', 'maxRetries']),
    );

    // If the payload is inspected, ensure sensitive values are redacted.
    if (entry.payload) {
      expect(entry.payload).toEqual(redactSensitive(entry.payload));
    }
  });

  it('writes no audit entry when the config PUT is rejected', async () => {
    const res = await request(mountedApp)
      .put('/api/admin/config')
      .set('x-test-user-id', 'admin-user')
      .send({ maxRetries: 'not-a-number' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
