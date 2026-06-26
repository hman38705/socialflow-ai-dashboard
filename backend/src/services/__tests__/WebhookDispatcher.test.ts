import { attemptDelivery, dispatchEvent, retryPendingDeliveries } from '../WebhookDispatcher';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: {
    webhookSubscription: { findMany: jest.fn() },
    webhookDelivery: { create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { prisma } = jest.requireMock('../../lib/prisma') as {
  prisma: {
    webhookSubscription: { findMany: jest.Mock };
    webhookDelivery: { create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  };
};

const DELIVERY_ID = 'del-1';
const URL = 'https://example.com/hook';
const SECRET = 'secret';
const PAYLOAD = JSON.stringify({ id: 'evt-1', version: '1.0', event: 'post.published' });

function mockFetch(ok: boolean, status = ok ? 200 : 500) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    text: jest.fn().mockResolvedValue(''),
  });
}

beforeEach(() => jest.clearAllMocks());

// ── attemptDelivery ────────────────────────────────────────────────────────

describe('attemptDelivery', () => {
  it('marks delivery as success on 2xx response', async () => {
    mockFetch(true);
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 1);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DELIVERY_ID },
        data: expect.objectContaining({ status: 'success' }),
      }),
    );
  });

  it('schedules a retry (status=pending) on failure when below MAX_ATTEMPTS', async () => {
    mockFetch(false, 500);
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 1);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', attempts: 1 }),
      }),
    );
  });

  it('marks delivery as permanently failed after MAX_ATTEMPTS (5)', async () => {
    mockFetch(false, 500);
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 5);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', attempts: 5 }),
      }),
    );
  });

  it('marks delivery as failed when fetch throws (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 5);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('does not permanently fail when attempt < MAX_ATTEMPTS and fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 2);

    const call = prisma.webhookDelivery.update.mock.calls[0][0];
    expect(call.data.status).toBe('pending');
  });
});

// ── dispatchEvent ──────────────────────────────────────────────────────────

describe('dispatchEvent', () => {
  it('creates a delivery row per active subscriber and fires delivery', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', url: URL, secret: SECRET },
    ]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: DELIVERY_ID });
    mockFetch(true);
    prisma.webhookDelivery.update.mockResolvedValue({});

    await dispatchEvent('post.published' as any, { postId: '1' });

    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subscriptionId: 'sub-1', status: 'pending' }),
      }),
    );
  });

  it('does nothing when there are no active subscribers', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([]);

    await dispatchEvent('post.published' as any, {});

    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('logs an error instead of swallowing when attemptDelivery rejects unexpectedly', async () => {
    const { createLogger } = jest.requireMock('../../lib/logger') as {
      createLogger: () => { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
    };
    const loggerInstance = createLogger();

    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-2', url: URL, secret: SECRET },
    ]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-2' });
    // Make fetch throw so attemptDelivery itself throws past its own try/catch
    global.fetch = jest.fn().mockRejectedValue(new Error('catastrophic'));
    // Make prisma.update also reject so error bubbles out of attemptDelivery
    prisma.webhookDelivery.update.mockRejectedValue(new Error('db failure'));

    await dispatchEvent('post.published' as any, {});
    // Allow the fire-and-forget microtask to settle
    await new Promise((r) => setImmediate(r));

    expect(loggerInstance.error).toHaveBeenCalledWith(
      expect.stringContaining('fire-and-forget'),
      expect.objectContaining({ deliveryId: 'del-2', subscriptionId: 'sub-2' }),
    );
  });
});

// ── retryPendingDeliveries ─────────────────────────────────────────────────

describe('retryPendingDeliveries', () => {
  it('re-attempts each due delivery', async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([
      {
        id: DELIVERY_ID,
        payload: PAYLOAD,
        attempts: 1,
        subscription: { url: URL, secret: SECRET },
      },
    ]);
    mockFetch(true);
    prisma.webhookDelivery.update.mockResolvedValue({});

    await retryPendingDeliveries();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success' }),
      }),
    );
  });
});
