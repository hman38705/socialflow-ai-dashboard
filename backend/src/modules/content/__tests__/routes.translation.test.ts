import express from 'express';
import request from 'supertest';

jest.mock('../translationService', () => ({
  translationService: {
    translate: jest.fn(),
  },
}));

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = { id: 'user-1', role: 'user' };
      return next();
    }
    return next(Object.assign(new Error('Unauthorized'), { status: 401 }));
  },
  requirePermission: () => (req: any, _res: any, next: any) => {
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    return next(Object.assign(new Error('Forbidden'), { status: 403 }));
  },
}));

import { translationService } from '../translationService';
import translationRouter from '../routes.translation';

const mockedTranslate = translationService.translate as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/content', translationRouter);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('routes.translation POST /translate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a successful translation for a valid request', async () => {
    mockedTranslate.mockResolvedValue({ translatedText: 'Hola mundo' });

    const res = await request(buildApp())
      .post('/content/translate')
      .set('Authorization', 'Bearer valid-token')
      .send({ text: 'Hello world', targetLanguage: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ translatedText: 'Hola mundo' });
    expect(mockedTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello world', targetLanguage: 'es' })
    );
  });

  it('rejects a request with an invalid body', async () => {
    const res = await request(buildApp())
      .post('/content/translate')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(mockedTranslate).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(buildApp())
      .post('/content/translate')
      .send({ text: 'Hello world', targetLanguage: 'es' });

    expect(res.status).toBe(401);
    expect(mockedTranslate).not.toHaveBeenCalled();
  });
});
