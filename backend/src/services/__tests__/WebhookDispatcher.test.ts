import crypto from 'crypto';
import {
  attemptDelivery,
  assertSafeUrl,
  dispatchEvent,
  retryPendingDeliveries,
  deliveryTransport,
} from '../WebhookDispatcher';
import { encryptWebhookSecret } from '../../lib/webhookSecretCrypto';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: {
    webhookSubscription: { findMany: jest.fn() },
    webhookDelivery: { create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  },
}));

// createLogger must return the SAME mock instance on every call — the
// source module calls it once at import time, and tests call it again to
// grab a reference; a fresh object per call would make assertions on the
// test's reference silently never see calls made via the source's instance.
jest.mock('../../lib/logger', () => {
  const sharedLoggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { createLogger: () => sharedLoggerMock };
});

jest.mock('../../lib/metrics', () => ({
  webhookDispatchFailed: { inc: jest.fn() },
  webhookDispatchTotal: { inc: jest.fn() },
}));

jest.mock('../../config/config', () => ({
  config: { WEBHOOK_SECRET_ENCRYPTION_KEY: '00'.repeat(32) },
}));

// Mock dns/promises so assertSafeUrl doesn't make real DNS calls
jest.mock('dns/promises', () => ({
  resolve4: jest.fn().mockResolvedValue(['93.184.216.34']),
  resolve6: jest.fn().mockResolvedValue([]),
}));

// Mock https so safeFetch doesn't make real network calls
jest.mock('https', () => ({
  Agent: jest.fn().mockImplementation(() => ({})),
  request: jest.fn(),
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
// Subscriptions read from prisma store the secret encrypted; attemptDelivery
// itself still takes the raw secret directly (used by tests below).
const ENCRYPTED_SECRET = encryptWebhookSecret(SECRET);
const PAYLOAD = JSON.stringify({ id: 'evt-1', version: '1.0', event: 'post.published' });

// Mock safeFetch at the module level — replaced per-test as needed
const mockSafeFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  // Default: safeFetch returns a successful 200 response
  mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: null,
    text: jest.fn().mockResolvedValue(''),
  });
});

// Patch safeFetch on the imported module
beforeAll(() => {
  jest
    .spyOn(deliveryTransport, 'safeFetch')
    .mockImplementation((...args: unknown[]) => mockSafeFetch(...args));
});

// ── attemptDelivery ────────────────────────────────────────────────────────

describe('attemptDelivery', () => {
  it('marks delivery as success on 2xx response', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
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
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 1);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', attempts: 1 }),
      }),
    );
  });

  it('marks delivery as permanently failed after MAX_ATTEMPTS (5)', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 5);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', attempts: 5 }),
      }),
    );
  });

  it('marks delivery as failed when safeFetch throws (network error)', async () => {
    mockSafeFetch.mockRejectedValue(new Error('network error'));
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 5);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('does not permanently fail when attempt < MAX_ATTEMPTS and safeFetch throws', async () => {
    mockSafeFetch.mockRejectedValue(new Error('network error'));
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 2);

    const call = prisma.webhookDelivery.update.mock.calls[0][0];
    expect(call.data.status).toBe('pending');
  });

  it('treats a 3xx redirect response as a failed delivery (#1775)', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 302,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 1);

    const call = prisma.webhookDelivery.update.mock.calls[0][0];
    expect(call.data.status).toBe('pending');
    expect(call.data.errorMessage).toContain('302');
  });
});

// ── dispatchEvent ──────────────────────────────────────────────────────────

describe('dispatchEvent', () => {
  it('creates a delivery row per active subscriber and fires delivery', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', url: URL, secret: ENCRYPTED_SECRET },
    ]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: DELIVERY_ID });
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
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
      { id: 'sub-2', url: URL, secret: ENCRYPTED_SECRET },
    ]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-2' });
    // Make safeFetch throw so attemptDelivery itself throws past its own try/catch
    mockSafeFetch.mockRejectedValue(new Error('catastrophic'));
    // Make prisma.update also reject so error bubbles out of attemptDelivery
    prisma.webhookDelivery.update.mockRejectedValue(new Error('db failure'));

    await dispatchEvent('post.published' as any, {});
    // Allow the fire-and-forget chain (including the real async DNS lookup
    // inside assertSafeUrl) to settle — a single setImmediate isn't enough.
    for (let i = 0; i < 50 && loggerInstance.error.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(loggerInstance.error).toHaveBeenCalledWith(
      expect.stringContaining('fire-and-forget'),
      expect.objectContaining({ deliveryId: 'del-2', subscriptionId: 'sub-2' }),
    );
  });

  it('signs the outbound delivery with the decrypted raw secret, not the stored ciphertext', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-3', url: URL, secret: ENCRYPTED_SECRET },
    ]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-3' });
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
    prisma.webhookDelivery.update.mockResolvedValue({});

    await dispatchEvent('post.published' as any, { postId: '1' });
    for (let i = 0; i < 50 && mockSafeFetch.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const options = mockSafeFetch.mock.calls[0]?.[2] as { headers: Record<string, string> };
    const actualBody = (
      prisma.webhookDelivery.create.mock.calls[0][0] as { data: { payload: string } }
    ).data.payload;
    const expected =
      'sha256=' + crypto.createHmac('sha256', SECRET).update(actualBody).digest('hex');

    expect(options.headers['X-SocialFlow-Signature']).toBe(expected);
    // Sanity check: signing with the raw stored ciphertext would NOT match.
    const wrongSig =
      'sha256=' + crypto.createHmac('sha256', ENCRYPTED_SECRET).update(actualBody).digest('hex');
    expect(options.headers['X-SocialFlow-Signature']).not.toBe(wrongSig);
  });
});

// ── assertSafeUrl (SSRF protection — #1776) ───────────────────────────────

describe('assertSafeUrl', () => {
  it('rejects a webhook URL pointing at the cloud metadata endpoint', async () => {
    await expect(assertSafeUrl('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /blocked address/,
    );
  });

  it('rejects a webhook URL pointing at loopback', async () => {
    await expect(assertSafeUrl('https://127.0.0.1/')).rejects.toThrow(/blocked address/);
  });

  it('rejects a webhook URL pointing at CGNAT (100.64.0.0/10)', async () => {
    await expect(assertSafeUrl('https://100.64.0.1/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects a webhook URL pointing at a reserved range (192.0.0.0/24)', async () => {
    await expect(assertSafeUrl('https://192.0.0.1/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects a webhook URL pointing at benchmarking range (198.18.0.0/15)', async () => {
    await expect(assertSafeUrl('https://198.18.0.1/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects a webhook URL pointing at multicast (224.0.0.1)', async () => {
    await expect(assertSafeUrl('https://224.0.0.1/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects a webhook URL using a non-https scheme', async () => {
    await expect(assertSafeUrl('http://example.com/hook')).rejects.toThrow(/https/);
  });

  it('allows a webhook URL pointing at a public https address and returns the IP', async () => {
    const result = await assertSafeUrl('https://example.com/hook');
    expect(typeof result).toBe('string');
    expect(result).toBe('93.184.216.34');
  });

  it('rejects IPv6 loopback (::1)', async () => {
    await expect(assertSafeUrl('https://[::1]/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects IPv6 ULA (fc00::/7)', async () => {
    await expect(assertSafeUrl('https://[fc00::1]/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects IPv6 link-local (fe80::/10)', async () => {
    await expect(assertSafeUrl('https://[fe80::1]/hook')).rejects.toThrow(/blocked address/);
  });

  it('rejects IPv4-mapped IPv6 (::ffff:127.0.0.1)', async () => {
    await expect(assertSafeUrl('https://[::ffff:127.0.0.1]/hook')).rejects.toThrow(
      /blocked address/,
    );
  });
});

describe('attemptDelivery — SSRF re-validation at delivery time', () => {
  it('blocks delivery to the cloud metadata endpoint and marks it failed without calling safeFetch', async () => {
    mockSafeFetch.mockClear();
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(
      DELIVERY_ID,
      'https://169.254.169.254/latest/meta-data/',
      SECRET,
      PAYLOAD,
      1,
    );

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', nextRetryAt: null }),
      }),
    );
  });

  it('blocks delivery to loopback and marks it failed without calling safeFetch', async () => {
    mockSafeFetch.mockClear();
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, 'https://127.0.0.1/hook', SECRET, PAYLOAD, 1);

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', nextRetryAt: null }),
      }),
    );
  });

  it('blocks delivery to CGNAT and marks it failed without calling safeFetch', async () => {
    mockSafeFetch.mockClear();
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, 'https://100.64.0.1/hook', SECRET, PAYLOAD, 1);

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', nextRetryAt: null }),
      }),
    );
  });

  it('connects to the validated IP returned by assertSafeUrl (#1777 DNS rebinding)', async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
    prisma.webhookDelivery.update.mockResolvedValue({});

    await attemptDelivery(DELIVERY_ID, URL, SECRET, PAYLOAD, 1);

    // safeFetch should be called with (url, validatedIP, options)
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, validatedIP] = mockSafeFetch.mock.calls[0];
    expect(calledUrl).toBe(URL);
    expect(typeof validatedIP).toBe('string');
    expect(validatedIP).toBe('93.184.216.34'); // from the DNS mock
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
        subscription: { url: URL, secret: ENCRYPTED_SECRET },
      },
    ]);
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: jest.fn().mockResolvedValue(''),
    });
    prisma.webhookDelivery.update.mockResolvedValue({});

    await retryPendingDeliveries();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success' }),
      }),
    );
  });
});
