/**
 * GET /health/readiness — unit tests
 */
import request from 'supertest';
import express from 'express';

jest.mock('../lib/integrationStatus', () => ({
  getIntegrationSnapshot: jest.fn(),
}));

const mockCheckDatabase = jest.fn();
jest.mock('../services/serviceFactory', () => ({
  getHealthService: jest.fn(() => ({ checkDatabase: mockCheckDatabase })),
  getHealthMonitor: jest.fn(),
  getAlertConfigService: jest.fn(),
}));

import { getIntegrationSnapshot } from '../lib/integrationStatus';
import healthRouter from '../routes/health';

const app = express();
app.use('/health', healthRouter);

describe('GET /health/readiness', () => {
  beforeEach(() => {
    mockCheckDatabase.mockResolvedValue({ status: 'healthy', latency: 1, lastChecked: new Date().toISOString(), errorRate: 0 });
  });

  it('returns 503 with status=starting when snapshot is null', async () => {
    (getIntegrationSnapshot as jest.Mock).mockReturnValue(null);
    const res = await request(app).get('/health/readiness');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('starting');
  });

  it('returns 503 with status=not_ready when database is unreachable', async () => {
    (getIntegrationSnapshot as jest.Mock).mockReturnValue([
      { name: 'youtube', enabled: true },
    ]);
    mockCheckDatabase.mockResolvedValue({
      status: 'unhealthy',
      latency: 5000,
      lastChecked: new Date().toISOString(),
      errorRate: 100,
      error: 'Connection refused',
    });
    const res = await request(app).get('/health/readiness');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.reason).toBe('database_unavailable');
  });

  it('returns 200 with status=ready when database is healthy and all integrations are enabled', async () => {
    (getIntegrationSnapshot as jest.Mock).mockReturnValue([
      { name: 'youtube', enabled: true },
      { name: 'stripe', enabled: true },
    ]);
    const res = await request(app).get('/health/readiness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('returns 503 with status=degraded when database is healthy but an integration is disabled', async () => {
    (getIntegrationSnapshot as jest.Mock).mockReturnValue([
      { name: 'youtube', enabled: false, reason: 'YOUTUBE_CLIENT_ID not set' },
      { name: 'stripe', enabled: true },
    ]);
    const res = await request(app).get('/health/readiness');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.integrations).toHaveLength(2);
  });
});
