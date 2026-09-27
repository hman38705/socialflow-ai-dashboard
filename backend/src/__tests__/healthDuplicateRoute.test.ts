/**
 * Regression test for #1593 — duplicate unauthenticated health module routes.
 *
 * Previously backend/src/modules/health/routes.ts was mounted at /api/health
 * with zero authentication middleware, allowing any unauthenticated caller to
 * PUT /api/health/config/:service and silently overwrite alert thresholds.
 *
 * These tests assert that the /api/health surface is gone and every mutating
 * or sensitive operation requires the authenticated /api/v1/health path.
 */
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

import request from 'supertest';
import app from '../app';

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
    checkDatabase: jest.fn(() => ({
      status: 'healthy',
      latency: 1,
      lastChecked: new Date().toISOString(),
      errorRate: 0,
    })),
  })),
  getHealthMonitor: jest.fn(() => ({
    getMetrics: jest.fn(() => []),
  })),
  getAlertConfigService: jest.fn(() => ({
    getConfig: jest.fn(() => ({
      enabled: true,
      thresholds: { errorRatePercent: 10, responseTimeMs: 100, consecutiveFailures: 3 },
      cooldownMs: 60000,
    })),
    setConfig: jest.fn(),
  })),
}));

describe('Regression #1593 — duplicate unauthenticated /api/health routes removed', () => {
  describe('PUT /api/health/config/:service — must not be reachable without auth', () => {
    it('unauthenticated PUT /api/health/config/facebook returns 401 or 404', async () => {
      const res = await request(app)
        .put('/api/health/config/facebook')
        .send({
          enabled: true,
          thresholds: { errorRatePercent: 99, responseTimeMs: 1, consecutiveFailures: 1 },
          cooldownMs: 0,
        });
      // Route must be gone (404) or require authentication (401).
      // 200 means the unauthenticated duplicate is still mounted — that is the bug.
      expect([401, 404]).toContain(res.status);
    });

    it('unauthenticated PUT /api/health/config/database returns 401 or 404', async () => {
      const res = await request(app)
        .put('/api/health/config/database')
        .send({
          enabled: true,
          thresholds: { errorRatePercent: 99, responseTimeMs: 1, consecutiveFailures: 1 },
          cooldownMs: 0,
        });
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('GET /api/health/config — must not leak config to unauthenticated callers', () => {
    it('unauthenticated GET /api/health/config returns 401 or 404', async () => {
      const res = await request(app).get('/api/health/config');
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('GET /api/health/status — must not leak dependency details without auth', () => {
    it('unauthenticated GET /api/health/status returns 401 or 404', async () => {
      const res = await request(app).get('/api/health/status');
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('GET /api/health/metrics — must not leak metrics without auth', () => {
    it('unauthenticated GET /api/health/metrics returns 401 or 404', async () => {
      const res = await request(app).get('/api/health/metrics');
      expect([401, 404]).toContain(res.status);
    });

    it('unauthenticated GET /api/health/metrics/:service returns 401 or 404', async () => {
      const res = await request(app).get('/api/health/metrics/database');
      expect([401, 404]).toContain(res.status);
    });
  });
});
