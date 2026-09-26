import express from 'express';
import request from 'supertest';

const JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

jest.mock('../../../config/config', () => ({ config: { JWT_SECRET } }));

jest.mock('../../../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    keyFromPayload: jest.fn(() => 'key'),
    isBlacklisted: jest.fn(async () => false),
  },
}));

const mockPost = jest.fn();
jest.mock('../../../services/FacebookService', () => ({
  facebookService: {
    postToPageWithUserToken: (...args: any[]) => mockPost(...args),
    isConfigured: () => true,
  },
}));

import router from '../routes.facebook';

const app = express();
app.use(express.json());
app.use('/api/facebook', router);

describe('POST /api/facebook/post', () => {
  it('returns 401 without a SocialFlow auth header even with an x-facebook-token', async () => {
    const res = await request(app)
      .post('/api/facebook/post')
      .set('x-facebook-token', 'fb-token')
      .send({ pageId: '123', message: 'hello' });
    expect(res.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
