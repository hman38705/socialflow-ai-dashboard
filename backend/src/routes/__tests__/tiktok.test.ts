import express from 'express';
import request from 'supertest';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', permissions: ['tiktok:upload'] };
    next();
  },
  checkPermission: (permission: string) => (req: any, res: any, next: any) => {
    const permissions: string[] = req.user?.permissions ?? [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

const enqueueTikTokVideoUpload = jest.fn().mockResolvedValue({ jobId: 'job-1' });
jest.mock('../../services/tiktokUploadQueue', () => ({
  enqueueTikTokVideoUpload: (...args: any[]) => enqueueTikTokVideoUpload(...args),
}));

import tiktokRouter from '../tiktok';

const buildApp = (permissions: string[] = ['tiktok:upload']) => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: 'user-1', permissions };
    next();
  });
  app.use('/tiktok', tiktokRouter);
  return app;
};

describe('tiktok routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('kicks off the OAuth flow', async () => {
    const app = buildApp();
    const res = await request(app).get('/tiktok/oauth/authorize');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('tiktok.com');
  });

  it('enqueues a chunked video upload', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/tiktok/upload')
      .send({ videoUrl: 'https://example.com/video.mp4', title: 'My video' });

    expect(res.status).toBeLessThan(400);
    expect(enqueueTikTokVideoUpload).toHaveBeenCalledTimes(1);
  });

  it('rejects uploads when the permission check fails', async () => {
    const app = buildApp([]);
    const res = await request(app)
      .post('/tiktok/upload')
      .send({ videoUrl: 'https://example.com/video.mp4', title: 'My video' });

    expect(res.status).toBe(403);
    expect(enqueueTikTokVideoUpload).not.toHaveBeenCalled();
  });
});
