import request from 'supertest';
import express, { Response, NextFunction } from 'express';
import videoRouter from '../modules/content/routes.video';

jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req: any, res: Response, next: NextFunction) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ message: 'Unauthorized' });
    req.user = { id };
    return next();
  },
}));

const jobs = new Map<string, any>();
jest.mock('../services/VideoService', () => ({
  videoService: {
    createTranscodingJob: jest.fn(async () => {
      jobs.set('job-1', { id: 'job-1' });
      return 'job-1';
    }),
    getJob: jest.fn((id: string) => jobs.get(id)),
    getAllJobs: jest.fn(() => Array.from(jobs.values())),
    cancelJob: jest.fn(async () => true),
  },
}));
jest.mock('../queues/VideoQueue', () => ({ videoQueue: { getStatus: jest.fn(() => ({})) } }));
jest.mock('../services/VideoHealthService', () => ({
  videoHealthService: { getHealthStatus: jest.fn(async () => ({ status: 'healthy' })) },
}));

const app = express();
app.use('/video', videoRouter);

describe('module-tree /video routes auth', () => {
  it('returns 401 for POST /upload without auth', async () => {
    const res = await request(app).post('/video/upload');
    expect(res.status).toBe(401);
  });

  it('returns 401 for GET /jobs without auth', async () => {
    expect((await request(app).get('/video/jobs')).status).toBe(401);
  });

  it('keeps /health public', async () => {
    expect((await request(app).get('/video/health')).status).toBe(200);
  });

  it("does not let another user list, read or cancel someone else's job", async () => {
    const owner = { 'x-test-user': 'u1' };
    const other = { 'x-test-user': 'u2' };
    const up = await request(app)
      .post('/video/upload')
      .set(owner)
      .attach('video', Buffer.from('x'), { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(up.status).toBe(202);

    expect((await request(app).get('/video/jobs').set(owner)).body.jobs).toHaveLength(1);
    expect((await request(app).get('/video/jobs').set(other)).body.jobs).toHaveLength(0);
    expect((await request(app).get('/video/job/job-1').set(other)).status).toBe(404);
    expect((await request(app).delete('/video/job/job-1').set(other)).status).toBe(404);
    expect((await request(app).delete('/video/job/job-1').set(owner)).status).toBe(200);
  });
});
