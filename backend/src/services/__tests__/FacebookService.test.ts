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

import { facebookService } from '../FacebookService';

describe('FacebookService', () => {
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  it('fetches managed pages successfully', async () => {
    const response = {
      data: [
        {
          id: 'page-1',
          name: 'Test Page',
          access_token: 'page-token-1',
          category: 'Business',
        },
      ],
    };

    nock('https://graph.facebook.com')
      .get('/v18.0/me/accounts')
      .query(true)
      .reply(200, response);

    const pages = await facebookService.getUserPages('user-token');

    expect(pages).toEqual(response.data);
  });

  it('throws when Facebook page fetch returns 401', async () => {
    nock('https://graph.facebook.com')
      .get('/v18.0/me/accounts')
      .query(true)
      .reply(401, { error: { message: 'Invalid OAuth access token.' } });

    await expect(facebookService.getUserPages('bad-token')).rejects.toThrow(
      /Failed to fetch Facebook pages/,
    );
  });

  it('posts to page with user token successfully', async () => {
    const svc = facebookService as any;
    svc.getPageAccessToken = jest.fn().mockResolvedValue('page-token');
    svc.getPostPermalink = jest.fn().mockResolvedValue('https://facebook.com/post/123');

    nock('https://graph.facebook.com')
      .post('/v18.0/1234/feed')
      .query(true)
      .reply(200, { id: 'post-123' });

    const result = await facebookService.postToPageWithUserToken('user-token', {
      pageId: '1234',
      message: 'Hello Facebook!',
    });

    expect(result.id).toBe('post-123');
    expect(result.permalink_url).toBe('https://facebook.com/post/123');
    expect(svc.getPageAccessToken).toHaveBeenCalledWith('user-token', '1234');
  });

  it('throws on Facebook rate limit when fetching comments', async () => {
    nock('https://graph.facebook.com')
      .get('/v18.0/post-123/comments')
      .query(true)
      .reply(429, { error: { message: 'Too many requests' } });

    await expect(
      facebookService.getPostComments('1234', 'post-123', 'page-token'),
    ).rejects.toThrow(/Failed to fetch comments/);
  });
});
