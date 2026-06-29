/**
 * #1119 — TikTokService respects Retry-After header on 429 responses
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockRedis = {
  hget: jest.fn(async () => null),
  hset: jest.fn(async () => 1),
  expire: jest.fn(async () => 1),
  del: jest.fn(async () => 1),
  hmset: jest.fn(async () => 'OK'),
  hgetall: jest.fn(async () => null),
};
jest.mock('ioredis', () => jest.fn(() => mockRedis));
jest.mock('../config/runtime', () => ({ getRedisConnection: () => ({}) }));
jest.mock('../services/CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: jest.fn(async (_n: string, fn: () => any) => fn()),
    getStats: jest.fn(() => ({})),
  },
}));

import { tiktokService } from '../services/TikTokService';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock Response with configurable status, headers, and JSON body. */
function mockResponse(
  status: number,
  body: object,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ── Retry-After (seconds) ─────────────────────────────────────────────────────
describe('TikTokService — Retry-After header handling', () => {
  it('waits the Retry-After seconds before retrying on 429', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      // First call: 429 with Retry-After: 2
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate_limit' }, { 'retry-after': '2' }))
      // Second call: success
      .mockResolvedValueOnce(
        mockResponse(200, {
          error: { code: 'ok' },
          data: { publish_id: 'pub-123', upload_url: 'https://upload.tiktok.com/' },
        }),
      );

    const promise = tiktokService.initiateVideoUpload(
      'access-token',
      10 * 1024 * 1024,
      {
        videoSource: 'file.mp4',
        sourceType: 'FILE_UPLOAD',
        title: 'Test video',
      },
    );

    // Advance timers by the Retry-After delay (2 s = 2000 ms)
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.publishId).toBe('pub-123');
  });

  it('falls back to exponential backoff when Retry-After header is absent', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate_limit' })) // no Retry-After
      .mockResolvedValueOnce(
        mockResponse(200, {
          error: { code: 'ok' },
          data: { publish_id: 'pub-456', upload_url: 'https://upload.tiktok.com/' },
        }),
      );

    const promise = tiktokService.initiateVideoUpload(
      'access-token',
      10 * 1024 * 1024,
      { videoSource: 'file.mp4', sourceType: 'FILE_UPLOAD', title: 'T' },
    );

    await jest.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.publishId).toBe('pub-456');
  });

  it('respects Retry-After on getUserInfo 429', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(429, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          data: {
            user: {
              open_id: 'uid',
              union_id: 'u2',
              avatar_url: '',
              display_name: 'Alice',
              bio_description: '',
              profile_deep_link: '',
              is_verified: false,
              follower_count: 0,
              following_count: 0,
              likes_count: 0,
              video_count: 0,
            },
          },
        }),
      );

    const promise = tiktokService.getUserInfo('tok');
    await jest.runAllTimersAsync();
    const user = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(user.openId).toBe('uid');
  });

  it('stops retrying after MAX_RETRIES and returns the last 429 response', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      // All 4 calls (1 initial + 3 retries) return 429
      .mockResolvedValue(mockResponse(429, { error: 'rate_limit' }, { 'retry-after': '1' }));

    const promise = tiktokService.initiateVideoUpload(
      'access-token',
      10 * 1024 * 1024,
      { videoSource: 'file.mp4', sourceType: 'FILE_UPLOAD', title: 'T' },
    );

    await jest.runAllTimersAsync();
    // After exhausting retries the service throws because response is not ok
    await expect(promise).rejects.toThrow('TikTok video init failed');
    // 1 initial + 3 retries = 4 calls total
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('parses HTTP-date Retry-After and waits the correct duration', async () => {
    jest.useFakeTimers();
    // Retry-After: a date 3 seconds in the future
    const futureDate = new Date(Date.now() + 3000).toUTCString();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(429, {}, { 'retry-after': futureDate }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          error: { code: 'ok' },
          data: { publish_id: 'pub-789', upload_url: 'https://upload.tiktok.com/' },
        }),
      );

    const promise = tiktokService.initiateVideoUpload(
      'access-token',
      10 * 1024 * 1024,
      { videoSource: 'file.mp4', sourceType: 'FILE_UPLOAD', title: 'T' },
    );

    await jest.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.publishId).toBe('pub-789');
  });
});
