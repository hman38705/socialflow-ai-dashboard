process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import { AuditLogStore } from '../models/AuditLog';
import { createTestUser, generateTestToken } from './fixtures';

jest.mock('../lib/integrationStatus', () => ({
  getIntegrationSnapshot: jest.fn(() => [
    { name: 'twitter', enabled: true },
    { name: 'youtube', enabled: true },
  ]),
}));

jest.mock('../services/serviceFactory', () => ({
  getHealthService: jest.fn(() => ({
    getSystemStatus: jest.fn(() => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {},
    })),
  })),
  getHealthMonitor: jest.fn(() => ({
    getMetrics: jest.fn((service?: string) => (service ? [{
      service,
      healthy: true,
      latency: 10,
    }] : [{
      service: 'database',
      healthy: true,
      latency: 5,
    }])),
  })),
  getAlertConfigService: jest.fn(() => ({
    getConfig: jest.fn((service: string) => ({
      enabled: true,
      thresholds: {
        errorRatePercent: 10,
        responseTimeMs: 100,
        consecutiveFailures: 3,
      },
      cooldownMs: 60000,
    })),
    setConfig: jest.fn(() => true),
  })),
}));

const admin = createTestUser('admin', 'admin-health-1');
const editor = createTestUser('editor', 'editor-health-1');
const viewer = createTestUser('viewer', 'viewer-health-1');

const adminId = admin.userId;
const editorId = editor.userId;
const viewerId = viewer.userId;

function token(userId: string) {
  return generateTestToken(userId);
}

beforeAll(() => {
  // Users are already registered in RoleStore by createTestUser above.
  // This hook is kept for any additional setup that may be added later.
});

describe('Health Routes — Authorization Boundaries', () => {
  describe('Unauthorized Access (No Token)', () => {
    it('GET /health/readiness returns 200 without token (unauthenticated probe route)', async () => {
      const res = await request(app).get('/health/readiness');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('GET /health/status returns 401 without token', async () => {
      const res = await request(app).get('/health/status');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });

    it('GET /health/metrics returns 401 without token', async () => {
      const res = await request(app).get('/health/metrics');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });

    it('GET /health/metrics/:service returns 401 without token', async () => {
      const res = await request(app).get('/health/metrics/database');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });

    it('GET /health/config returns 401 without token', async () => {
      const res = await request(app).get('/health/config');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });

    it('PUT /health/config/:service returns 401 without token', async () => {
      const res = await request(app)
        .put('/health/config/database')
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 15,
            responseTimeMs: 150,
            consecutiveFailures: 5,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Unauthorized');
    });
  });

  describe('Read Access (GET Endpoints) — Non-Admin Can Read', () => {
    it('Viewer can GET /health/readiness', async () => {
      const res = await request(app)
        .get('/health/readiness')
        .set('Authorization', `Bearer ${token(viewerId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('integrations');
    });

    it('Viewer can GET /health/status', async () => {
      const res = await request(app)
        .get('/health/status')
        .set('Authorization', `Bearer ${token(viewerId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('Viewer can GET /health/metrics', async () => {
      const res = await request(app)
        .get('/health/metrics')
        .set('Authorization', `Bearer ${token(viewerId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
    });

    it('Viewer can GET /health/metrics/:service', async () => {
      const res = await request(app)
        .get('/health/metrics/database')
        .set('Authorization', `Bearer ${token(viewerId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
    });

    it('Viewer can GET /health/config', async () => {
      const res = await request(app)
        .get('/health/config')
        .set('Authorization', `Bearer ${token(viewerId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('database');
    });

    it('Editor can GET /health/readiness', async () => {
      const res = await request(app)
        .get('/health/readiness')
        .set('Authorization', `Bearer ${token(editorId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('Editor can GET /health/status', async () => {
      const res = await request(app)
        .get('/health/status')
        .set('Authorization', `Bearer ${token(editorId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('Editor can GET /health/metrics', async () => {
      const res = await request(app)
        .get('/health/metrics')
        .set('Authorization', `Bearer ${token(editorId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
    });

    it('Editor can GET /health/metrics/:service', async () => {
      const res = await request(app)
        .get('/health/metrics/redis')
        .set('Authorization', `Bearer ${token(editorId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
    });

    it('Editor can GET /health/config', async () => {
      const res = await request(app)
        .get('/health/config')
        .set('Authorization', `Bearer ${token(editorId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('database');
    });

    it('Admin can GET /health/readiness', async () => {
      const res = await request(app)
        .get('/health/readiness')
        .set('Authorization', `Bearer ${token(adminId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('Admin can GET /health/status', async () => {
      const res = await request(app)
        .get('/health/status')
        .set('Authorization', `Bearer ${token(adminId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('Admin can GET /health/metrics', async () => {
      const res = await request(app)
        .get('/health/metrics')
        .set('Authorization', `Bearer ${token(adminId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
    });

    it('Admin can GET /health/metrics/:service', async () => {
      const res = await request(app)
        .get('/health/metrics/s3')
        .set('Authorization', `Bearer ${token(adminId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
    });

    it('Admin can GET /health/config', async () => {
      const res = await request(app)
        .get('/health/config')
        .set('Authorization', `Bearer ${token(adminId)}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('database');
      expect(res.body).toHaveProperty('redis');
      expect(res.body).toHaveProperty('s3');
    });
  });

  describe('Write Access (PUT Endpoints) — Admin Only', () => {
    it('Viewer does NOT have health:config:update permission', async () => {
      const res = await request(app)
        .put('/health/config/database')
        .set('Authorization', `Bearer ${token(viewerId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 15,
            responseTimeMs: 150,
            consecutiveFailures: 5,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Forbidden');
      expect(res.body.missing).toContain('health:config:update');
    });

    it('Editor does NOT have health:config:update permission', async () => {
      const res = await request(app)
        .put('/health/config/redis')
        .set('Authorization', `Bearer ${token(editorId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 20,
            responseTimeMs: 200,
            consecutiveFailures: 4,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Forbidden');
      expect(res.body.missing).toContain('health:config:update');
    });

    it('Admin CAN update health config for database', async () => {
      const res = await request(app)
        .put('/health/config/database')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 15,
            responseTimeMs: 150,
            consecutiveFailures: 5,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Configuration updated');
      expect(res.body).toHaveProperty('config');
    });

    it('Admin CAN update health config for redis', async () => {
      const res = await request(app)
        .put('/health/config/redis')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 20,
            responseTimeMs: 200,
            consecutiveFailures: 4,
          },
          cooldownMs: 45000,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Configuration updated');
      expect(res.body).toHaveProperty('config');
    });

    it('Admin CAN update health config for s3', async () => {
      const res = await request(app)
        .put('/health/config/s3')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 25,
            responseTimeMs: 250,
            consecutiveFailures: 6,
          },
          cooldownMs: 90000,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Configuration updated');
      expect(res.body).toHaveProperty('config');
    });

    it('Admin CAN update health config for twitter', async () => {
      const res = await request(app)
        .put('/health/config/twitter')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 30,
            responseTimeMs: 300,
            consecutiveFailures: 7,
          },
          cooldownMs: 120000,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Configuration updated');
      expect(res.body).toHaveProperty('config');
    });

    it('Admin CAN update health config for youtube', async () => {
      const res = await request(app)
        .put('/health/config/youtube')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 35,
            responseTimeMs: 350,
            consecutiveFailures: 8,
          },
          cooldownMs: 150000,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Configuration updated');
      expect(res.body).toHaveProperty('config');
    });

    it('Admin CAN update health config for facebook', async () => {
      const res = await request(app)
        .put('/health/config/facebook')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 40,
            responseTimeMs: 400,
            consecutiveFailures: 9,
          },
          cooldownMs: 180000,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Configuration updated');
      expect(res.body).toHaveProperty('config');
    });
  });

  describe('Input Validation (Admin Authorization Only)', () => {
    it('Admin with invalid service parameter gets 422', async () => {
      const res = await request(app)
        .put('/health/config/invalid_service')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 10,
            responseTimeMs: 100,
            consecutiveFailures: 3,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('error');
    });

    it('Admin with invalid error rate gets 422', async () => {
      const res = await request(app)
        .put('/health/config/database')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 150, // Invalid: > 100
            responseTimeMs: 100,
            consecutiveFailures: 3,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('error');
    });

    it('Admin with negative response time gets 422', async () => {
      const res = await request(app)
        .put('/health/config/redis')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 10,
            responseTimeMs: -100, // Invalid: negative
            consecutiveFailures: 3,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('error');
    });

    it('Admin with invalid consecutive failures gets 422', async () => {
      const res = await request(app)
        .put('/health/config/s3')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 10,
            responseTimeMs: 100,
            consecutiveFailures: 0, // Invalid: < 1
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('error');
    });

    it('Non-admin gets 403 before validation (permission check first)', async () => {
      const res = await request(app)
        .put('/health/config/database')
        .set('Authorization', `Bearer ${token(editorId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 150, // Invalid, but not checked
            responseTimeMs: 100,
            consecutiveFailures: 3,
          },
          cooldownMs: 60000,
        });
      expect(res.status).toBe(403); // Permission denied before validation
      expect(res.body.message).toBe('Forbidden');
    });
  });

  describe('Audit Logging (Admin Updates Only)', () => {
    it('Admin config update is logged as audit event', async () => {
      const res = await request(app)
        .put('/health/config/database')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send({
          enabled: true,
          thresholds: {
            errorRatePercent: 15,
            responseTimeMs: 150,
            consecutiveFailures: 5,
          },
          cooldownMs: 60000,
        });
      
      expect(res.status).toBe(200);
      
      // Verify audit event was logged
      const logs = AuditLogStore.recent(50);
      const configUpdateLog = logs.find(
        (log) =>
          log.action === 'health:config:update' &&
          log.actorId === adminId &&
          log.resourceId === 'database'
      );
      expect(configUpdateLog).toBeDefined();
    });
  });

  describe('Non-Existent Service Handling', () => {
    it('GET /health/metrics for non-existent service returns 404', async () => {
      const res = await request(app)
        .get('/health/metrics/nonexistent')
        .set('Authorization', `Bearer ${token(adminId)}`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Service not found');
    });
  });

  describe('Permission-Based Behavior Boundaries', () => {
    it('All roles with valid token can read health status', async () => {
      const roles = [
        { userId: viewerId, roleName: 'viewer' },
        { userId: editorId, roleName: 'editor' },
        { userId: adminId, roleName: 'admin' },
      ];

      for (const { userId, roleName } of roles) {
        const res = await request(app)
          .get('/health/status')
          .set('Authorization', `Bearer ${token(userId)}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status');
      }
    });

    it('Only admin role can write to health config', async () => {
      const nonAdminRoles = [
        { userId: viewerId, roleName: 'viewer' },
        { userId: editorId, roleName: 'editor' },
      ];

      const payload = {
        enabled: true,
        thresholds: {
          errorRatePercent: 10,
          responseTimeMs: 100,
          consecutiveFailures: 3,
        },
        cooldownMs: 60000,
      };

      for (const { userId, roleName } of nonAdminRoles) {
        const res = await request(app)
          .put('/health/config/database')
          .set('Authorization', `Bearer ${token(userId)}`)
          .send(payload);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Forbidden');
      }

      const adminRes = await request(app)
        .put('/health/config/database')
        .set('Authorization', `Bearer ${token(adminId)}`)
        .send(payload);
      expect(adminRes.status).toBe(200);
    });

    it('Invalid token returns 401', async () => {
      const invalidToken = jwt.sign({ sub: 'unknown-user' }, 'wrong-secret');
      const res = await request(app)
        .get('/health/status')
        .set('Authorization', `Bearer ${invalidToken}`);
      expect(res.status).toBe(401);
    });

    it('Malformed Authorization header returns 401', async () => {
      const res = await request(app)
        .get('/health/status')
        .set('Authorization', 'InvalidFormat token');
      expect(res.status).toBe(401);
    });
  });
});
