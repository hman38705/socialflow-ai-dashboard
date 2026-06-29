// Jest manual mock for ioredis (no real Redis connection needed)
jest.mock('ioredis', () => {
  const store: Record<string, Record<string, string>> = {};
  const ttls: Record<string, number> = {};

  class RedisMock {
    async hget(key: string, field: string) {
      return store[key]?.[field] ?? null;
    }
    async hset(key: string, ...args: string[]) {
      store[key] ??= {};
      // hset(key, field, value) or hset(key, obj)
      if (args.length === 2) {
        store[key][args[0]] = args[1];
      } else {
        const obj = args[0] as unknown as Record<string, string>;
        Object.assign(store[key], obj);
      }
    }
    async hmset(key: string, obj: Record<string, string>) {
      store[key] = { ...(store[key] ?? {}), ...obj };
    }
    async hgetall(key: string) {
      return store[key] ?? null;
    }
    async expire(key: string, ttl: number) {
      ttls[key] = ttl;
    }
    async del(key: string) {
      delete store[key];
      delete ttls[key];
    }
    _store() {
      return store;
    }
    _clearAll() {
      Object.keys(store).forEach((k) => delete store[k]);
    }
  }

  return RedisMock;
});

jest.mock('../../config/runtime', () => ({
  getRedisConnection: () => ({ host: 'localhost', port: 6379 }),
}));

const mockExecute = jest.fn((_name: string, fn: () => unknown) => fn());

jest.mock('../CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: mockExecute,
    getStats: jest.fn(),
  },
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { tiktokService } from '../TikTokService';
import Redis from 'ioredis';

const redis = new (Redis as any)();

beforeEach(() => {
  mockFetch.mockReset();
  jest.clearAllMocks();
  redis._clearAll();
});

// ─── refreshAccessToken ────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  it('posts to token URL and returns mapped token payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        open_id: 'open-1',
        expires_in: 3600,
        refresh_expires_in: 86400,
        scope: 'video.publish',
      }),
    });

    const tokens = await tiktokService.refreshAccessToken('old-refresh');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://open.tiktokapis.com/v2/oauth/token/',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(tokens.accessToken).toBe('new-access');
    expect(tokens.refreshToken).toBe('new-refresh');
    expect(tokens.scope).toBe('video.publish');
  });

  it('throws when the token endpoint returns a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    });

    await expect(tiktokService.refreshAccessToken('bad-token')).rejects.toThrow(
      /TikTok token refresh failed/,
    );
  });
});

// ─── initiateVideoUpload ───────────────────────────────────────────────────

describe('initiateVideoUpload', () => {
  const request = {
    videoSource: '/tmp/video.mp4',
    sourceType: 'FILE_UPLOAD' as const,
    title: 'My Video',
  };

  it('calls init endpoint with correct content-size and chunk-count', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 'ok' },
        data: { publish_id: 'pub-1', upload_url: 'https://upload.tiktok.com/session/1' },
      }),
    });

    const fileSizeBytes = 25 * 1024 * 1024; // 25 MB → 3 chunks at 10 MB each
    const result = await tiktokService.initiateVideoUpload('token', fileSizeBytes, request);

    expect(result.publishId).toBe('pub-1');
    expect(result.totalChunks).toBe(3);
    expect(result.chunkSize).toBe(10 * 1024 * 1024);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.source_info.video_size).toBe(fileSizeBytes);
    expect(body.source_info.total_chunk_count).toBe(3);
  });

  it('throws when the init endpoint returns an error code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 'access_token_invalid', message: 'Token invalid' },
      }),
    });

    await expect(tiktokService.initiateVideoUpload('bad-token', 1024, request)).rejects.toThrow(
      /TikTok video init error/,
    );
  });
});

// ─── uploadChunk ──────────────────────────────────────────────────────────

describe('uploadChunk', () => {
  const SESSION_ID = 'session-abc';
  const UPLOAD_URL = 'https://upload.tiktok.com/session/abc';
  const CHUNK = Buffer.from('x'.repeat(1024));
  const TOTAL_SIZE = 2048;

  it('sends correct Content-Range header for the first chunk', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await tiktokService.uploadChunk(UPLOAD_URL, CHUNK, 0, 2, TOTAL_SIZE, SESSION_ID);

    const headers = (mockFetch.mock.calls[0][1] as any).headers;
    expect(headers['Content-Range']).toBe('bytes 0-1023/2048');
  });

  it('sends correct Content-Range header for a subsequent chunk', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 206 });

    await tiktokService.uploadChunk(UPLOAD_URL, CHUNK, 1, 2, TOTAL_SIZE, SESSION_ID);

    const headers = (mockFetch.mock.calls[0][1] as any).headers;
    expect(headers['Content-Range']).toBe('bytes 10485760-10486783/2048');
  });

  it('updates Redis progress hash after a successful chunk upload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await tiktokService.uploadChunk(UPLOAD_URL, CHUNK, 0, 2, TOTAL_SIZE, SESSION_ID);

    const lastChunk = await tiktokService.getLastUploadedChunk(SESSION_ID);
    expect(lastChunk).toBe(0);
  });

  it('skips the HTTP call when the chunk is already confirmed in Redis', async () => {
    // Pre-seed Redis to indicate chunk 0 was already uploaded
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await tiktokService.uploadChunk(UPLOAD_URL, CHUNK, 0, 2, TOTAL_SIZE, SESSION_ID);
    mockFetch.mockClear();

    // Second call for same chunk index should not hit fetch
    await tiktokService.uploadChunk(UPLOAD_URL, CHUNK, 0, 2, TOTAL_SIZE, SESSION_ID);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws and cleans up progress key when the upload fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(
      tiktokService.uploadChunk(UPLOAD_URL, CHUNK, 0, 2, TOTAL_SIZE, SESSION_ID),
    ).rejects.toThrow(/Chunk 1\/2 upload failed/);

    // Progress key should be deleted after failure
    const lastChunk = await tiktokService.getLastUploadedChunk(SESSION_ID);
    expect(lastChunk).toBe(-1);
  });
});

// ─── getLastUploadedChunk ─────────────────────────────────────────────────

describe('getLastUploadedChunk', () => {
  it('returns -1 when no progress exists for the session', async () => {
    const result = await tiktokService.getLastUploadedChunk('nonexistent-session');
    expect(result).toBe(-1);
  });
});

// ─── uploadVideoFromUrl (PULL_FROM_URL) ───────────────────────────────────

describe('uploadVideoFromUrl', () => {
  it('bypasses chunked upload and calls the URL-based endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 'ok' },
        data: { publish_id: 'pub-url-1' },
      }),
    });

    const result = await tiktokService.uploadVideoFromUrl('token', {
      videoSource: 'https://example.com/video.mp4',
      sourceType: 'PULL_FROM_URL',
      title: 'URL Video',
    });

    expect(result.publishId).toBe('pub-url-1');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.source_info.source).toBe('PULL_FROM_URL');
    expect(body.source_info.video_url).toBe('https://example.com/video.mp4');
    // Confirm it does NOT include chunked upload fields
    expect(body.source_info.chunk_size).toBeUndefined();
  });

  it('throws when the URL-based endpoint returns an error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_url' }),
    });

    await expect(
      tiktokService.uploadVideoFromUrl('token', {
        videoSource: 'https://bad.example.com/video.mp4',
        sourceType: 'PULL_FROM_URL',
        title: 'Bad URL Video',
      }),
    ).rejects.toThrow(/TikTok URL video upload failed/);
  });
});
