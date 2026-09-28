/**
 * Tests for backend/src/routes/twitter-webhook.ts (issue #1619).
 *
 * Exercises the HMAC-verified webhook ingestion handler:
 *  - valid signature  -> accepted (2xx) and enqueued to twitterWebhookQueue
 *  - invalid signature -> rejected (401/403) and NOT enqueued
 *  - missing signature header -> rejected and NOT enqueued
 */

const mockAdd = jest.fn().mockResolvedValue({ id: 'job-1' });

jest.mock('../../queues/twitterWebhookQueue', () => ({
  twitterWebhookQueue: { add: mockAdd },
}));

jest.mock('../../lib/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const TEST_SECRET = 'test-twitter-webhook-secret';

function sign(body: string, secret = TEST_SECRET): string {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
  );
}

function buildApp() {
  // Load the router fresh so it picks up the mocked queue/logger and the
  // current TWITTER_WEBHOOK_SECRET value.
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const router = require('../twitter-webhook').default;
  const app = express();
  app.use(router);
  return app;
}

describe('twitter-webhook route', () => {
  const originalSecret = process.env.TWITTER_WEBHOOK_SECRET;

  beforeEach(() => {
    mockAdd.mockClear();
    process.env.TWITTER_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.TWITTER_WEBHOOK_SECRET;
    } else {
      process.env.TWITTER_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('accepts a valid-signature request and enqueues the event', async () => {
    const app = buildApp();
    const payload = JSON.stringify({ for_user_id: '123', tweet_create_events: [] });

    const res = await request(app)
      .post('/webhooks/twitter')
      .set('Content-Type', 'application/json')
      .set('x-twitter-webhooks-signature', sign(payload))
      .send(payload);

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid-signature request and does not enqueue', async () => {
    const app = buildApp();
    const payload = JSON.stringify({ for_user_id: '123', tweet_create_events: [] });

    const res = await request(app)
      .post('/webhooks/twitter')
      .set('Content-Type', 'application/json')
      .set('x-twitter-webhooks-signature', sign(payload, 'wrong-secret'))
      .send(payload);

    expect([401, 403]).toContain(res.status);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects a request with a missing signature header and does not enqueue', async () => {
    const app = buildApp();
    const payload = JSON.stringify({ for_user_id: '123', tweet_create_events: [] });

    const res = await request(app)
      .post('/webhooks/twitter')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect([401, 403]).toContain(res.status);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
