// Must be set before any module import
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-32-chars!!!!!';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ||
  'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4';

import crypto from 'crypto';

// ── Mock prisma before importing dispatcher ───────────────────────────────────
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    webhookSubscription: { findMany: mockFindMany },
    webhookDelivery: {
      create: mockCreate,
      update: mockUpdate,
      findMany: jest.fn(),
      findUnique: mockFindUnique,
    },
  },
}));

// ── Mock BullMQ so WebhookQueue can be imported without Redis ─────────────────
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation((_name: string, processor: Function) => {
    // Expose the processor so tests can invoke it directly
    return { processor, on: jest.fn() };
  }),
}));

jest.mock('../config/runtime', () => ({ getRedisConnection: jest.fn(() => ({})) }));

// ── Mock fetch globally ───────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { attemptDelivery, dispatchEvent, retryPendingDeliveries } from '../services/WebhookDispatcher';
import { encryptWebhookSecret } from '../lib/webhookSecretCrypto';
import { MAX_ERROR_MESSAGE_LENGTH, TRUNCATION_MARKER } from '../jobs/webhookRetryJob';

beforeEach(() => jest.clearAllMocks());

// ── dispatchEvent ─────────────────────────────────────────────────────────────
describe('dispatchEvent', () => {
  it('does nothing when no active subscribers', async () => {
    mockFindMany.mockResolvedValue([]);
    await dispatchEvent('post.published', { postId: '1' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a delivery record for each subscriber', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'sub-1', url: 'https://example.com/hook', secret: encryptWebhookSecret('secret') },
    ]);
    mockCreate.mockResolvedValue({ id: 'del-1' });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    await dispatchEvent('post.published', { postId: '42' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'post.published', status: 'pending' }),
      }),
    );
  });
});

// ── attemptDelivery ───────────────────────────────────────────────────────────
describe('attemptDelivery', () => {
  const url = 'https://example.com/hook';
  const secret = 'my-signing-secret';
  const payload = '{"event":"post.published"}';

  it('marks delivery as success on 2xx response', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-1', url, secret, payload, 1);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success', attempts: 1 }),
      }),
    );
  });

  it('schedules retry on non-2xx response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-1', url, secret, payload, 1);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', nextRetryAt: expect.any(Date) }),
      }),
    );
  });

  it('marks permanently failed after MAX_ATTEMPTS (5)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-1', url, secret, payload, 5);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', nextRetryAt: null }),
      }),
    );
  });

  it('schedules retry on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-1', url, secret, payload, 2);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', errorMessage: 'ECONNREFUSED' }),
      }),
    );
  });

  it('sends correct HMAC-SHA256 signature header', async () => {
    const expectedSig =
      'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-1', url, secret, payload, 1);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-SocialFlow-Signature']).toBe(expectedSig);
  });

  it('includes X-SocialFlow-Delivery header with delivery id', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-xyz', url, secret, payload, 1);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-SocialFlow-Delivery']).toBe('del-xyz');
  });
});

// ── retryPendingDeliveries — secret rotation ──────────────────────────────────
describe('retryPendingDeliveries', () => {
  const payload = '{"event":"post.published"}';

  it('uses the current subscription secret, not a stale one', async () => {
    const rotatedSecret = 'rotated-secret';
    const expectedSig =
      'sha256=' + crypto.createHmac('sha256', rotatedSecret).update(payload).digest('hex');

    // Simulate a delivery whose subscription secret has been rotated
    (jest.requireMock('../lib/prisma').prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'del-retry',
        payload,
        attempts: 1,
        subscription: { url: 'https://example.com/hook', secret: encryptWebhookSecret(rotatedSecret) },
      },
    ]);
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    await retryPendingDeliveries();

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-SocialFlow-Signature']).toBe(expectedSig);
  });

  it('does NOT use the old secret after rotation', async () => {
    const oldSecret = 'old-secret';
    const rotatedSecret = 'rotated-secret';
    const staleSignature =
      'sha256=' + crypto.createHmac('sha256', oldSecret).update(payload).digest('hex');

    (jest.requireMock('../lib/prisma').prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'del-retry-2',
        payload,
        attempts: 1,
        subscription: { url: 'https://example.com/hook', secret: encryptWebhookSecret(rotatedSecret) },
      },
    ]);
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    await retryPendingDeliveries();

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-SocialFlow-Signature']).not.toBe(staleSignature);
  });
});

// ── webhookRetryJob — error message truncation ────────────────────────────────
describe('webhookRetryJob error truncation', () => {
  const url = 'https://example.com/hook';
  const secret = 'my-signing-secret';
  const payload = '{"event":"post.published"}';

  it('truncates an over-long error message to the configured limit with the marker appended', async () => {
    const longError = 'x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 500);
    mockFetch.mockRejectedValue(new Error(longError));
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-long', url, secret, payload, 1);

    const stored = mockUpdate.mock.calls[0][0].data.errorMessage as string;
    expect(stored.length).toBe(MAX_ERROR_MESSAGE_LENGTH + TRUNCATION_MARKER.length);
    expect(stored.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(stored.slice(0, MAX_ERROR_MESSAGE_LENGTH)).toBe(
      longError.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    );
  });

  it('stores a short error message unchanged', async () => {
    const shortError = 'ECONNREFUSED';
    mockFetch.mockRejectedValue(new Error(shortError));
    mockUpdate.mockResolvedValue({});

    await attemptDelivery('del-short', url, secret, payload, 1);

    const stored = mockUpdate.mock.calls[0][0].data.errorMessage as string;
    expect(stored).toBe(shortError);
    expect(stored.endsWith(TRUNCATION_MARKER)).toBe(false);
  });
});

// ── startWebhookWorker — secret rotation ─────────────────────────────────────
describe('startWebhookWorker', () => {
  it('processes deliveries using the current subscription secret', async () => {
    const rotatedSecret = 'rotated-secret';
    const expectedSig =
      'sha256=' + crypto.createHmac('sha256', rotatedSecret).update(payload).digest('hex');

    (jest.requireMock('../lib/prisma').prisma.webhookDelivery.findUnique as jest.Mock).mockResolvedValue({
      id: 'del-worker',
      payload,
      attempts: 1,
      subscription: { url: 'https://example.com/hook', secret: encryptWebhookSecret(rotatedSecret) },
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    mockUpdate.mockResolvedValue({});

    const { startWebhookWorker } = await import('../jobs/webhookRetryJob');
    const worker = startWebhookWorker() as unknown as { processor: Function };
    await worker.processor({ data: { deliveryId: 'del-worker' } });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-SocialFlow-Signature']).toBe(expectedSig);
  });
});
