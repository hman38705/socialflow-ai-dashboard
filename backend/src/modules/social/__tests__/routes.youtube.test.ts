import express from 'express';
import request from 'supertest';

// Mock the auth middleware so we can control whether a SocialFlow session is
// present without depending on the real session/DB wiring. The route file is
// expected to apply this middleware to every data-returning route.
jest.mock('../../auth/middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (req.headers.authorization === 'Bearer valid-session') {
      req.user = { id: 'user-1' };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  },
}));

// Stub the YouTube service so the route handlers never hit the network. The
// token must be resolved server-side from the authenticated user, not from the
// caller-supplied query string.
jest.mock('../../services/YouTubeService', () => ({
  youTubeService: {
    getChannel: jest.fn().mockResolvedValue({ id: 'channel-1' }),
    getVideoStats: jest.fn().mockResolvedValue({ views: 0 }),
  },
}));

// Stub the per-user token lookup used by the route handlers.
jest.mock('../../services/youtubeTokenService', () => ({
  getStoredYouTubeAccessToken: jest.fn().mockResolvedValue('stored-token'),
}));

import youtubeRouter from '../routes.youtube';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/youtube', youtubeRouter);
  return app;
}

describe('modules/social/routes.youtube auth', () => {
  const app = buildApp();

  it('GET /api/youtube/channel returns 401 without a valid SocialFlow session', async () => {
    const res = await request(app).get('/api/youtube/channel');
    expect(res.status).toBe(401);
  });

  it('GET /api/youtube/videos/stats returns 401 without a valid SocialFlow session', async () => {
    const res = await request(app).get('/api/youtube/videos/stats');
    expect(res.status).toBe(401);
  });

  it('GET /api/youtube/channel ignores a caller-supplied access_token query param', async () => {
    const res = await request(app)
      .get('/api/youtube/channel')
      .query({ access_token: 'attacker-supplied-token' });
    expect(res.status).toBe(401);
  });

  it('GET /api/youtube/videos/stats ignores a caller-supplied access_token query param', async () => {
    const res = await request(app)
      .get('/api/youtube/videos/stats')
      .query({ access_token: 'attacker-supplied-token' });
    expect(res.status).toBe(401);
  });

  it('GET /api/youtube/channel succeeds with a valid SocialFlow session', async () => {
    const res = await request(app)
      .get('/api/youtube/channel')
      .set('Authorization', 'Bearer valid-session');
    expect(res.status).toBe(200);
  });

  it('GET /api/youtube/videos/stats succeeds with a valid SocialFlow session', async () => {
    const res = await request(app)
      .get('/api/youtube/videos/stats')
      .set('Authorization', 'Bearer valid-session');
    expect(res.status).toBe(200);
  });
});
