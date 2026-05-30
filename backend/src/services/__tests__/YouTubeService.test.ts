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

describe('YouTubeService', () => {
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  it('fetches channel info successfully', async () => {
    nock('https://www.googleapis.com')
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
  });

  it('throws YouTubeQuotaError when quota is exceeded', async () => {
    nock('https://www.googleapis.com')
      .get('/youtube/v3/channels')
      .query(true)
      .reply(403, {
        error: {
          errors: [
            { domain: 'youtube.quota', reason: 'quotaExceeded' },
          ],
        },
      });

    await expect(youTubeService.getChannel('quota-token')).rejects.toBeInstanceOf(
      YouTubeQuotaError,
    );
  });

  it('throws on unauthorized video stats request', async () => {
    nock('https://www.googleapis.com')
      .get('/youtube/v3/videos')
      .query(true)
      .reply(401, { error: { errors: [{ domain: 'global', reason: 'authError' }] } });

    await expect(youTubeService.getVideoStats('invalid-token', ['video-1'])).rejects.toThrow(
      /YouTube API error/,
    );
  });

  it('lists channel videos successfully', async () => {
    nock('https://www.googleapis.com')
      .get('/youtube/v3/search')
      .query(true)
      .reply(200, {
        items: [
          { id: { videoId: 'video-1' } },
          { id: { videoId: 'video-2' } },
        ],
      });

    const videos = await youTubeService.listChannelVideos('valid-token', 2);

    expect(videos).toEqual(['video-1', 'video-2']);
  });
});
