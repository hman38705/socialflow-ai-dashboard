import nock from 'nock';

const mockExecute = jest.fn((_name: string, fn: () => unknown) => fn());

jest.mock('../CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: mockExecute,
    getStats: jest.fn(),
  },
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { YouTubeQuotaError, youTubeService } from '../YouTubeService';

const GOOGLE_API = 'https://www.googleapis.com';
const OAUTH_API = 'https://oauth2.googleapis.com';

describe('YouTubeService', () => {
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  describe('getChannel – video metadata fetch', () => {
    it('fetches channel info successfully', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/channels')
        .query(true)
        .reply(200, {
          items: [
            {
              id: 'channel-abc',
              snippet: { title: 'Test Channel' },
              statistics: { subscriberCount: '500', videoCount: '5', viewCount: '1000' },
            },
          ],
        });

      const channel = await youTubeService.getChannel('valid-token');

      expect(channel.id).toBe('channel-abc');
      expect(channel.title).toBe('Test Channel');
      expect(channel.subscriberCount).toBe(500);
      expect(channel.videoCount).toBe(5);
      expect(channel.viewCount).toBe(1000);
    });

    it('throws when no channel is found for account', async () => {
      nock(GOOGLE_API).get('/youtube/v3/channels').query(true).reply(200, { items: [] });

      await expect(youTubeService.getChannel('valid-token')).rejects.toThrow(
        'No channel found for this account',
      );
    });

    it('throws a plain error on non-quota 403', async () => {
      nock(GOOGLE_API).get('/youtube/v3/channels').query(true).reply(403, {
        error: { code: 403, errors: [{ domain: 'youtube', reason: 'forbidden' }] },
      });

      await expect(youTubeService.getChannel('token')).rejects.toThrow(/YouTube API error/);
    });
  });

  describe('getVideoStats – video metadata fetch', () => {
    it('returns stats for multiple video IDs', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/videos')
        .query(true)
        .reply(200, {
          items: [
            {
              id: 'vid1',
              snippet: {
                title: 'Video One',
                publishedAt: '2024-01-01T00:00:00Z',
                channelId: 'ch1',
                channelTitle: 'My Channel',
              },
              statistics: { viewCount: '100', likeCount: '10', commentCount: '5' },
            },
          ],
        });

      const stats = await youTubeService.getVideoStats('token', ['vid1']);

      expect(Array.isArray(stats)).toBe(true);
      const items = stats as any[];
      expect(items[0].videoId).toBe('vid1');
      expect(items[0].title).toBe('Video One');
      expect(items[0].viewCount).toBe(100);
      expect(items[0].likeCount).toBe(10);
    });

    it('returns empty array when videoIds is empty (no API call)', async () => {
      const result = await youTubeService.getVideoStats('token', []);
      expect(result).toEqual([]);
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('throws on unauthorized video stats request', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/videos')
        .query(true)
        .reply(401, { error: { errors: [{ domain: 'global', reason: 'authError' }] } });

      await expect(youTubeService.getVideoStats('invalid-token', ['video-1'])).rejects.toThrow(
        /YouTube API error/,
      );
    });
  });

  describe('quota-exceeded handling', () => {
    it('throws YouTubeQuotaError when quota is exceeded on getChannel', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/channels')
        .query(true)
        .reply(403, {
          error: { errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }] },
        });

      await expect(youTubeService.getChannel('quota-token')).rejects.toBeInstanceOf(
        YouTubeQuotaError,
      );
    });

    it('YouTubeQuotaError has a retryAfter date in the future', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/channels')
        .query(true)
        .reply(403, {
          error: { errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }] },
        });

      let err: YouTubeQuotaError | undefined;
      try {
        await youTubeService.getChannel('token');
      } catch (e: any) {
        err = e;
      }

      expect(err).toBeInstanceOf(YouTubeQuotaError);
      expect(err!.retryAfter).toBeInstanceOf(Date);
      expect(err!.retryAfter.getTime()).toBeGreaterThan(Date.now());
      // retryAfter should be within 25 hours (next midnight Pacific)
      expect(err!.retryAfter.getTime() - Date.now()).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('throws YouTubeQuotaError on dailyLimitExceeded for getVideoStats', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/videos')
        .query(true)
        .reply(403, {
          error: { errors: [{ domain: 'youtube.quota', reason: 'dailyLimitExceeded' }] },
        });

      await expect(youTubeService.getVideoStats('token', ['vid1'])).rejects.toBeInstanceOf(
        YouTubeQuotaError,
      );
    });

    it('throws YouTubeQuotaError on listChannelVideos quota exceeded', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/search')
        .query(true)
        .reply(403, {
          error: { errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }] },
        });

      await expect(youTubeService.listChannelVideos('token')).rejects.toBeInstanceOf(
        YouTubeQuotaError,
      );
    });
  });

  describe('OAuth token refresh', () => {
    beforeEach(() => {
      process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
      process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
    });

    it('refreshAccessToken exchanges refresh token for new access token', async () => {
      nock(OAUTH_API)
        .post('/token')
        .reply(200, {
          access_token: 'new-access-token',
          expires_in: 3600,
        });

      const tokens = await youTubeService.refreshAccessToken('my-refresh-token');

      expect(tokens.accessToken).toBe('new-access-token');
      expect(tokens.refreshToken).toBe('my-refresh-token');
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it('refreshAccessToken throws when token endpoint returns error', async () => {
      nock(OAUTH_API)
        .post('/token')
        .reply(400, { error: 'invalid_grant', error_description: 'Token has been expired' });

      await expect(youTubeService.refreshAccessToken('expired-token')).rejects.toThrow(
        /Token refresh failed/,
      );
    });

    it('exchangeCode returns tokens on success', async () => {
      nock(OAUTH_API)
        .post('/token')
        .reply(200, {
          access_token: 'access-abc',
          refresh_token: 'refresh-abc',
          expires_in: 3600,
        });

      const tokens = await youTubeService.exchangeCode('auth-code-123');

      expect(tokens.accessToken).toBe('access-abc');
      expect(tokens.refreshToken).toBe('refresh-abc');
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it('exchangeCode throws when token exchange fails', async () => {
      nock(OAUTH_API)
        .post('/token')
        .reply(400, { error: 'invalid_client' });

      await expect(youTubeService.exchangeCode('bad-code')).rejects.toThrow(
        /OAuth token exchange failed/,
      );
    });
  });

  describe('listChannelVideos', () => {
    it('lists channel videos successfully', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/search')
        .query(true)
        .reply(200, {
          items: [{ id: { videoId: 'video-1' } }, { id: { videoId: 'video-2' } }],
        });

      const videos = await youTubeService.listChannelVideos('valid-token', 0);

      expect(videos).toEqual(['video-1', 'video-2']);
    });

    it('paginates through multiple pages', async () => {
      nock(GOOGLE_API)
        .get('/youtube/v3/search')
        .query(true)
        .reply(200, {
          items: [{ id: { videoId: 'vid-1' } }],
          nextPageToken: 'page2',
        });

      nock(GOOGLE_API)
        .get('/youtube/v3/search')
        .query(true)
        .reply(200, {
          items: [{ id: { videoId: 'vid-2' } }],
        });

      const videos = await youTubeService.listChannelVideos('valid-token', 0);

      expect(videos).toEqual(['vid-1', 'vid-2']);
    });
  });
});
