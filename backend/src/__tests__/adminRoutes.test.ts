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

import { RoleStore } from '../models/Role';
import adminRouter from '../routes/admin';
import * as migrationService from '../admin/migrationService';
import * as jobAdminService from '../admin/jobAdminService';
import {
  SSETicketService,
  SSE_TICKET_MAP_CAP,
} from '../services/SSETicketService';

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

// Central error handler convention (see #1761): { success: false, code, message, timestamp }
function expectErrorShape(body: any) {
  expect(body).toBeDefined();
  expect(body.success).toBe(false);
  expect(typeof body.code).toBe('string');
  expect(typeof body.message).toBe('string');
  expect(body.timestamp).toBeDefined();
}

describe('Admin force guard (#2061)', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    jest.clearAllMocks();
  });

  it('rejects POST /admin/migrations/run without force', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({});
    expect(res.status).toBe(400);
    expectErrorShape(res.body);
    // The guard must short-circuit before the destructive operation runs.
    expect(migrationService.runMigrations).not.toHaveBeenCalled();
  });

  it('rejects POST /admin/migrations/run when force is false', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({ force: false });
    expect(res.status).toBe(400);
    expectErrorShape(res.body);
    expect(migrationService.runMigrations).not.toHaveBeenCalled();
  });

  it('proceeds with POST /admin/migrations/run when force is true', async () => {
    const res = await request(app)
      .post('/admin/migrations/run')
      .set('x-test-user-id', 'admin-user')
      .send({ force: true });
    expect(res.status).toBe(200);
    expect(migrationService.runMigrations).toHaveBeenCalled();
  });
});

describe('Admin limit parameter validation (#2063)', () => {
  beforeEach(() => {
    RoleStore.assign('admin-user', 'admin');
    jest.clearAllMocks();
  });

  it('rejects a non-numeric limit with 400', async () => {
    const res = await request(app)
      .get('/admin/jobs/queues?limit=abc')
      .set('x-test-user-id', 'admin-user');
    expect(res.status).toBe(400);
    expectErrorShape(res.body);
  });

  it('rejects a negative limit', async () => {
    const res = await request(app)
      .get('/admin/jobs/queues?limit=-5')
      .set('x-test-user-id', 'admin-user');
    expect(res.status).toBe(400);
    expectErrorShape(res.body);
  });

  it('accepts a valid limit and returns success', async () => {
    const res = await request(app)
      .get('/admin/jobs/queues?limit=10')
      .set('x-test-user-id', 'admin-user');
    expect(res.status).toBe(200);
    expect(jobAdminService.getDiscoveredQueueNames).toHaveBeenCalled();
  });
});

describe('SSE ticket map size cap eviction (#2064)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    SSETicketService.clear();
  });

  afterEach(() => {
    SSETicketService.clear();
    jest.useRealTimers();
  });

  it('never grows the ticket map past its cap', () => {
    for (let i = 0; i < SSE_TICKET_MAP_CAP + 10; i++) {
      jest.advanceTimersByTime(1);
      SSETicketService.issueTicket(`user-${i}`);
      expect(SSETicketService.size()).toBeLessThanOrEqual(SSE_TICKET_MAP_CAP);
    }
  });

  it('evicts the oldest ticket when the cap is reached', () => {
    for (let i = 0; i < SSE_TICKET_MAP_CAP; i++) {
      jest.advanceTimersByTime(1);
      SSETicketService.issueTicket(`user-${i}`);
    }
    expect(SSETicketService.size()).toBe(SSE_TICKET_MAP_CAP);

    jest.advanceTimersByTime(1);
    const overflowTicket = SSETicketService.issueTicket('user-overflow');

    expect(SSETicketService.size()).toBeLessThanOrEqual(SSE_TICKET_MAP_CAP);
    // The oldest entry (user-0) must be the one evicted, not an arbitrary key.
    expect(SSETicketService.has(`user-0`)).toBe(false);
    expect(SSETicketService.has('user-1')).toBe(true);
    expect(SSETicketService.has('user-overflow')).toBe(true);
    expect(overflowTicket).toBeDefined();
  });
});
