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

import { tiktokService } from '../TikTokService';

describe('TikTokService', () => {
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  it('returns TikTok user info successfully', async () => {
    const response = {
      data: {
        user: {
          open_id: 'open-123',
          union_id: 'union-123',
          avatar_url: 'https://cdn.example.com/avatar.jpg',
          display_name: 'Test Creator',
          bio_description: 'Bio text',
          profile_deep_link: 'https://tiktok.com/@test',
          is_verified: true,
          follower_count: 1000,
          following_count: 100,
          likes_count: 2500,
          video_count: 10,
        },
      },
    };

    nock('https://open.tiktokapis.com')
      .get('/v2/user/info/')
      .query(true)
      .reply(200, response);

    const result = await tiktokService.getUserInfo('valid-token');

    expect(result.openId).toBe('open-123');
    expect(result.displayName).toBe('Test Creator');
    expect(result.likeCount).toBe(2500);
  });

  it('throws when TikTok user info returns 401 Unauthorized', async () => {
    nock('https://open.tiktokapis.com')
      .get('/v2/user/info/')
      .query(true)
      .reply(401, { error: { message: 'Unauthorized' } });

    await expect(tiktokService.getUserInfo('bad-token')).rejects.toThrow(
      /Failed to fetch TikTok user info/,
    );
  });

  it('throws on rate limit response from TikTok user info', async () => {
    nock('https://open.tiktokapis.com')
      .get('/v2/user/info/')
      .query(true)
      .reply(429, { error: { message: 'Too Many Requests' } });

    await expect(tiktokService.getUserInfo('rate-limit-token')).rejects.toThrow(
      /Failed to fetch TikTok user info/,
    );
  });
});
