process.env.JWT_SECRET = 'test-secret';

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import { RoleStore } from '../models/Role';

jest.mock('../lib/integrationStatus', () => ({
  getIntegrationSnapshot: jest.fn(() => []),
}));

jest.mock('../services/serviceFactory', () => ({
  getHealthService: jest.fn(() => ({ getSystemStatus: jest.fn() })),
  getHealthMonitor: jest.fn(() => ({ getMetrics: jest.fn(() => []) })),
  getAlertConfigService: jest.fn(() => ({
    getConfig: jest.fn(() => ({})),
    setConfig: jest.fn(),
  })),
}));

const ADMIN_ID = 'admin-validation-1';
const SECRET = 'test-secret';
const adminToken = () => `Bearer ${jwt.sign({ sub: ADMIN_ID }, SECRET, { expiresIn: '15m' })}`;

const VALID_PAYLOAD = {
  enabled: true,
  thresholds: { errorRatePercent: 10, responseTimeMs: 100, consecutiveFailures: 3 },
  cooldownMs: 60000,
};

beforeAll(() => {
  RoleStore.assign(ADMIN_ID, 'admin');
});

// ---------------------------------------------------------------------------
// Table-driven: invalid body payloads → 422
// ---------------------------------------------------------------------------
describe('PUT /health/config/:service — invalid body payloads return 422', () => {
  const cases: Array<{ label: string; body: object; field: string }> = [
    {
      label: 'errorRatePercent above 100',
      body: { ...VALID_PAYLOAD, thresholds: { ...VALID_PAYLOAD.thresholds, errorRatePercent: 101 } },
      field: 'thresholds.errorRatePercent',
    },
    {
      label: 'errorRatePercent below 0',
      body: { ...VALID_PAYLOAD, thresholds: { ...VALID_PAYLOAD.thresholds, errorRatePercent: -1 } },
      field: 'thresholds.errorRatePercent',
    },
    {
      label: 'responseTimeMs negative',
      body: { ...VALID_PAYLOAD, thresholds: { ...VALID_PAYLOAD.thresholds, responseTimeMs: -1 } },
      field: 'thresholds.responseTimeMs',
    },
    {
      label: 'responseTimeMs non-integer',
      body: { ...VALID_PAYLOAD, thresholds: { ...VALID_PAYLOAD.thresholds, responseTimeMs: 1.5 } },
      field: 'thresholds.responseTimeMs',
    },
    {
      label: 'consecutiveFailures zero',
      body: { ...VALID_PAYLOAD, thresholds: { ...VALID_PAYLOAD.thresholds, consecutiveFailures: 0 } },
      field: 'thresholds.consecutiveFailures',
    },
    {
      label: 'consecutiveFailures non-integer',
      body: { ...VALID_PAYLOAD, thresholds: { ...VALID_PAYLOAD.thresholds, consecutiveFailures: 1.5 } },
      field: 'thresholds.consecutiveFailures',
    },
    {
      label: 'cooldownMs negative',
      body: { ...VALID_PAYLOAD, cooldownMs: -1 },
      field: 'cooldownMs',
    },
    {
      label: 'cooldownMs non-integer',
      body: { ...VALID_PAYLOAD, cooldownMs: 1.5 },
      field: 'cooldownMs',
    },
    {
      label: 'enabled missing',
      body: { thresholds: VALID_PAYLOAD.thresholds, cooldownMs: 60000 },
      field: 'enabled',
    },
    {
      label: 'thresholds missing',
      body: { enabled: true, cooldownMs: 60000 },
      field: 'thresholds',
    },
    {
      label: 'entire body empty',
      body: {},
      field: 'enabled',
    },
  ];

  it.each(cases)('$label → 422 with errors array containing field "$field"', async ({ body, field }) => {
    const res = await request(app)
      .put('/health/config/database')
      .set('Authorization', adminToken())
      .send(body);

    expect(res.status).toBe(422);
    // Stable 4xx format: errors array with field/message objects
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: { field: string }) => e.field === field)).toBe(true);
    res.body.errors.forEach((e: unknown) => {
      expect(e).toMatchObject({ field: expect.any(String), message: expect.any(String) });
    });
  });
});

// ---------------------------------------------------------------------------
// Table-driven: unknown service names → 422
// ---------------------------------------------------------------------------
describe('PUT /health/config/:service — unknown service names return 422', () => {
  const unknownServices = ['postgres', 'mysql', 'kafka', 'unknown', 'REDIS', 'Database', ''];

  it.each(unknownServices)('service "%s" → 422', async (service) => {
    const res = await request(app)
      .put(`/health/config/${service}`)
      .set('Authorization', adminToken())
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors[0]).toMatchObject({ field: 'service', message: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Stable 4xx error format contract
// ---------------------------------------------------------------------------
describe('4xx error format contract', () => {
  it('422 body validation error has only errors array (no success/code wrapper)', async () => {
    const res = await request(app)
      .put('/health/config/database')
      .set('Authorization', adminToken())
      .send({});

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('errors');
    expect(Array.isArray(res.body.errors)).toBe(true);
    // validate middleware does NOT wrap in success/code — assert shape is stable
    expect(res.body.errors[0]).toEqual(
      expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
    );
  });

  it('422 param validation error identifies the service field', async () => {
    const res = await request(app)
      .put('/health/config/notaservice')
      .set('Authorization', adminToken())
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('service');
  });

  it('401 unauthenticated error has message field', async () => {
    const res = await request(app).put('/health/config/database').send(VALID_PAYLOAD);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('message');
  });

  it('403 forbidden error has message and missing fields', async () => {
    const viewerId = 'viewer-validation-1';
    RoleStore.assign(viewerId, 'viewer');
    const viewerToken = `Bearer ${jwt.sign({ sub: viewerId }, SECRET, { expiresIn: '15m' })}`;

    const res = await request(app)
      .put('/health/config/database')
      .set('Authorization', viewerToken)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('missing');
  });
});
