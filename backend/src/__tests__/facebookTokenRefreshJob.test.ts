/**
 * #618 — Facebook long-lived token refresh BullMQ job
 */

// ── mock ioredis ─────────────────────────────────────────────────────────────
type HashStore = Record<string, Record<string, string>>;
const hashStore: HashStore = {};

const mockRedis = {
  scan: jest.fn(),
  hgetall: jest.fn(async (key: string) => hashStore[key] ?? {}),
  hset: jest.fn(async (key: string, data: Record<string, string>) => {
    if (!hashStore[key]) hashStore[key] = {};
    Object.assign(hashStore[key], data);
    return 1;
  }),
  expireat: jest.fn(async () => 1),
  persist: jest.fn(async () => 1),
};
jest.mock('ioredis', () => jest.fn(() => mockRedis));
jest.mock('../config/runtime', () => ({ getRedisConnection: () => ({}) }));

// ── mock BullMQ ───────────────────────────────────────────────────────────────
let capturedProcessor: ((job: any) => Promise<any>) | null = null;
const mockQueue = { add: jest.fn(), close: jest.fn() };
const mockWorker = { on: jest.fn(), close: jest.fn() };

jest.mock('bullmq', () => ({
  Queue: jest.fn(() => mockQueue),
  Worker: jest.fn((_name: string, processor: (job: any) => Promise<any>) => {
    capturedProcessor = processor;
    return mockWorker;
  }),
}));

// ── mock FacebookService ──────────────────────────────────────────────────────
const mockGetLongLivedUserToken = jest.fn();
jest.mock('../services/FacebookService', () => ({
  facebookService: {
    isConfigured: () => true,
    getLongLivedUserToken: mockGetLongLivedUserToken,
  },
}));

import { startFacebookTokenRefreshJob, FACEBOOK_TOKEN_KEY } from '../jobs/facebookTokenRefreshJob';

const NOW = Date.now();
const SOON = NOW + 5 * 24 * 60 * 60 * 1000;   // 5 days — within 10-day threshold
const LATER = NOW + 30 * 24 * 60 * 60 * 1000; // 30 days — outside threshold

// Start the job once; capturedProcessor is set by the Worker constructor mock
beforeAll(async () => {
  await startFacebookTokenRefreshJob();
});

beforeEach(() => {
  Object.keys(hashStore).forEach((k) => delete hashStore[k]);
  mockRedis.scan.mockReset();
  mockGetLongLivedUserToken.mockReset();
  mockRedis.hset.mockClear();
});

function setupScan(keys: string[]) {
  mockRedis.scan.mockResolvedValueOnce(['0', keys]);
}

describe('facebookTokenRefreshJob', () => {
  it('refreshes tokens expiring within 10 days', async () => {
    const key = FACEBOOK_TOKEN_KEY('user-1');
    hashStore[key] = { accessToken: 'old-token', expiresAt: String(SOON) };
    setupScan([key]);

    const newExpiry = NOW + 60 * 86400_000;
    mockGetLongLivedUserToken.mockResolvedValueOnce({ accessToken: 'new-token', expiresAt: newExpiry });

    const result = await capturedProcessor!({ id: 'job-1', data: {} });

    expect(mockGetLongLivedUserToken).toHaveBeenCalledWith('old-token');
    expect(mockRedis.hset).toHaveBeenCalledWith(key, {
      accessToken: 'new-token',
      expiresAt: String(newExpiry),
    });
    expect(result).toEqual({ refreshed: 1, failed: 0 });
  });

  it('skips tokens not expiring within 10 days', async () => {
    const key = FACEBOOK_TOKEN_KEY('user-2');
    hashStore[key] = { accessToken: 'valid-token', expiresAt: String(LATER) };
    setupScan([key]);

    const result = await capturedProcessor!({ id: 'job-2', data: {} });

    expect(mockGetLongLivedUserToken).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, failed: 0 });
  });

  it('counts failures without throwing when refresh fails', async () => {
    const key = FACEBOOK_TOKEN_KEY('user-3');
    hashStore[key] = { accessToken: 'expiring', expiresAt: String(SOON) };
    setupScan([key]);

    mockGetLongLivedUserToken.mockRejectedValueOnce(new Error('Facebook API error'));

    const result = await capturedProcessor!({ id: 'job-3', data: {} });

    expect(result).toEqual({ refreshed: 0, failed: 1 });
  });

  it('handles mixed success and failure across multiple tokens', async () => {
    const key1 = FACEBOOK_TOKEN_KEY('user-4');
    const key2 = FACEBOOK_TOKEN_KEY('user-5');
    hashStore[key1] = { accessToken: 'tok1', expiresAt: String(SOON) };
    hashStore[key2] = { accessToken: 'tok2', expiresAt: String(SOON) };
    setupScan([key1, key2]);

    mockGetLongLivedUserToken
      .mockResolvedValueOnce({ accessToken: 'new1', expiresAt: NOW + 60 * 86400_000 })
      .mockRejectedValueOnce(new Error('rate limited'));

    const result = await capturedProcessor!({ id: 'job-4', data: {} });

    expect(result).toEqual({ refreshed: 1, failed: 1 });
  });

  it('schedules a daily repeating job', () => {
    expect(mockQueue.add).toHaveBeenCalledWith(
      'refresh-facebook-tokens',
      {},
      expect.objectContaining({ repeat: expect.objectContaining({ pattern: expect.any(String) }) }),
    );
  });

  it('marks token as disconnected and does not count revocation as failure', async () => {
    const key = FACEBOOK_TOKEN_KEY('user-revoked');
    hashStore[key] = { accessToken: 'dead-token', expiresAt: String(SOON) };
    setupScan([key]);

    // Facebook error code 190 + subcode 458 = user removed app
    const revocationError = new Error(
      'Token refresh failed: {"error":{"code":190,"subcode":458}}',
    );
    mockGetLongLivedUserToken.mockRejectedValueOnce(revocationError);

    const result = await capturedProcessor!({ id: 'job-rev', data: {} });

    expect(mockRedis.hset).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ status: 'disconnected', disconnectReason: 'token_revoked' }),
    );
    expect(mockRedis.persist).toHaveBeenCalledWith(key);
    // Revocation is terminal — must NOT be counted as a retryable failure
    expect(result).toEqual({ refreshed: 0, failed: 0 });
  });

  it('treats each Facebook revocation subcode as non-retryable', async () => {
    const subcodes = [460, 463, 467];
    for (const subcode of subcodes) {
      Object.keys(hashStore).forEach((k) => delete hashStore[k]);
      mockRedis.hset.mockClear();
      mockRedis.persist.mockClear();
      mockGetLongLivedUserToken.mockReset();

      const key = FACEBOOK_TOKEN_KEY(`user-sub-${subcode}`);
      hashStore[key] = { accessToken: 'tok', expiresAt: String(SOON) };
      setupScan([key]);

      mockGetLongLivedUserToken.mockRejectedValueOnce(
        new Error(`Token refresh failed: {"error":{"code":190,"subcode":${subcode}}}`),
      );

      const result = await capturedProcessor!({ id: `job-sub-${subcode}`, data: {} });

      expect(mockRedis.persist).toHaveBeenCalledWith(key);
      expect(result).toEqual({ refreshed: 0, failed: 0 });
    }
  });

  it('counts a non-revocation Facebook error as a retryable failure', async () => {
    const key = FACEBOOK_TOKEN_KEY('user-apierr');
    hashStore[key] = { accessToken: 'tok', expiresAt: String(SOON) };
    setupScan([key]);

    // code 190 but subcode not in REVOCATION_SUBCODES (999 is not revocation)
    mockGetLongLivedUserToken.mockRejectedValueOnce(
      new Error('Token refresh failed: {"error":{"code":190,"subcode":999}}'),
    );

    const result = await capturedProcessor!({ id: 'job-apierr', data: {} });

    expect(mockRedis.persist).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, failed: 1 });
  });

  it('skips keys that are missing accessToken or expiresAt fields', async () => {
    const keyNoToken = FACEBOOK_TOKEN_KEY('user-no-token');
    const keyNoExpiry = FACEBOOK_TOKEN_KEY('user-no-expiry');
    hashStore[keyNoToken] = { expiresAt: String(SOON) };
    hashStore[keyNoExpiry] = { accessToken: 'tok' };
    setupScan([keyNoToken, keyNoExpiry]);

    const result = await capturedProcessor!({ id: 'job-missing', data: {} });

    expect(mockGetLongLivedUserToken).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, failed: 0 });
  });

  it('processes all keys across multiple Redis SCAN pages', async () => {
    const key1 = FACEBOOK_TOKEN_KEY('page-user-1');
    const key2 = FACEBOOK_TOKEN_KEY('page-user-2');
    hashStore[key1] = { accessToken: 'tok1', expiresAt: String(SOON) };
    hashStore[key2] = { accessToken: 'tok2', expiresAt: String(SOON) };

    // First SCAN call returns cursor '42' (not '0') to indicate more pages
    mockRedis.scan
      .mockResolvedValueOnce(['42', [key1]])
      .mockResolvedValueOnce(['0', [key2]]);

    const newExpiry = NOW + 60 * 86400_000;
    mockGetLongLivedUserToken
      .mockResolvedValueOnce({ accessToken: 'new1', expiresAt: newExpiry })
      .mockResolvedValueOnce({ accessToken: 'new2', expiresAt: newExpiry });

    const result = await capturedProcessor!({ id: 'job-pages', data: {} });

    expect(mockGetLongLivedUserToken).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ refreshed: 2, failed: 0 });
  });

  it('partial failure: revocation + success + generic error across three tokens', async () => {
    const keyRevoked = FACEBOOK_TOKEN_KEY('partial-revoked');
    const keyOk = FACEBOOK_TOKEN_KEY('partial-ok');
    const keyFailed = FACEBOOK_TOKEN_KEY('partial-failed');

    hashStore[keyRevoked] = { accessToken: 'dead', expiresAt: String(SOON) };
    hashStore[keyOk] = { accessToken: 'live', expiresAt: String(SOON) };
    hashStore[keyFailed] = { accessToken: 'err', expiresAt: String(SOON) };
    setupScan([keyRevoked, keyOk, keyFailed]);

    const newExpiry = NOW + 60 * 86400_000;
    mockGetLongLivedUserToken
      .mockRejectedValueOnce(
        new Error('Token refresh failed: {"error":{"code":190,"subcode":460}}'),
      )
      .mockResolvedValueOnce({ accessToken: 'new-live', expiresAt: newExpiry })
      .mockRejectedValueOnce(new Error('Network timeout'));

    const result = await capturedProcessor!({ id: 'job-partial', data: {} });

    expect(result).toEqual({ refreshed: 1, failed: 1 });
    expect(mockRedis.persist).toHaveBeenCalledWith(keyRevoked);
  });
});
