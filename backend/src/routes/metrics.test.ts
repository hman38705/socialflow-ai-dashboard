import express from 'express';
import request from 'supertest';
import metricsRouter from './metrics';

jest.mock('../queues/queueManager', () => ({
  queueManager: {
    refreshQueueMetrics: jest.fn(),
  },
}));

jest.mock('../lib/metrics', () => ({
  register: {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    metrics: jest.fn(async () => 'up 1\n'),
  },
}));

function makeApp(token?: string) {
  if (token === undefined) {
    delete process.env.METRICS_TOKEN;
  } else {
    process.env.METRICS_TOKEN = token;
  }

  const app = express();
  app.use('/metrics', metricsRouter);
  return app;
}

afterEach(() => {
  delete process.env.METRICS_TOKEN;
});

test('returns 401 with no Authorization header', async () => {
  const app = makeApp('supersecrettoken1234567890abcdef');
  await request(app).get('/metrics').expect(401);
});

test('returns 401 with wrong token', async () => {
  const app = makeApp('supersecrettoken1234567890abcdef');
  await request(app).get('/metrics').set('Authorization', 'Bearer wrongtoken').expect(401);
});

test('returns 200 with correct token', async () => {
  const token = 'supersecrettoken1234567890abcdef';
  const app = makeApp(token);
  const res = await request(app).get('/metrics').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/plain/);
});

test('returns 503 when METRICS_TOKEN is not set', async () => {
  const app = makeApp();
  await request(app).get('/metrics').expect(503);
});
