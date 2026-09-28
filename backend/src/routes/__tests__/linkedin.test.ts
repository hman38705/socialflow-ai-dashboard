import express from 'express';
import request from 'supertest';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', permissions: ['linkedin:share'] };
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

const redisStore = new Map<string, string>();

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
  },
}));

import linkedinRouter from '../linkedin';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/linkedin', linkedinRouter);
  return app;
};

describe('linkedin routes', () => {
  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();
  });

  describe('OAuth kickoff', () => {
    it('generates redis-backed state and returns an authorization URL', async () => {
      const app = buildApp();
      const res = await request(app).get('/linkedin/auth');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authUrl');
      expect(typeof res.body.authUrl).toBe('string');
      expect(res.body.authUrl).toContain('linkedin.com');

      const stateKeys = Array.from(redisStore.keys());
      expect(stateKeys.length).toBeGreaterThan(0);
      expect(redisStore.get(stateKeys[0])).toBeTruthy();
    });
  });

  describe('share publish', () => {
    it('publishes a LinkedInShareRequest successfully', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/linkedin/share')
        .send({ content: 'Hello LinkedIn', visibility: 'PUBLIC' });

      expect(res.status).toBeLessThan(400);
      expect(res.body).toBeDefined();
    });
  });

  describe('permission checks', () => {
    it('rejects a share request when the permission is missing', async () => {
      const auth = require('../../middleware/auth');
      const original = auth.authMiddleware;
      auth.authMiddleware = (req: any, _res: any, next: any) => {
        req.user = { id: 'user-2', permissions: [] };
        next();
      };

      const app = buildApp();
      const res = await request(app)
        .post('/linkedin/share')
        .send({ content: 'Nope', visibility: 'PUBLIC' });

      expect(res.status).toBe(403);

      auth.authMiddleware = original;
    });
  });
});
