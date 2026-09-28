/**
 * Route tests for backend/src/routes/translation.ts (issue #1618).
 *
 * Covers the second translation surface:
 *  - success path (translationService returns a translated payload)
 *  - validation-failure path (missing/invalid body fields)
 *  - permission-denied path (checkPermission rejects the request)
 */

import express from 'express';
import request from 'supertest';

const translateTextMock = jest.fn();
const checkPermissionMock = jest.fn();

jest.mock('../../services/translationService', () => ({
  __esModule: true,
  translationService: {
    translateText: (...args: unknown[]) => translateTextMock(...args),
  },
}));

jest.mock('../../middleware/auth', () => ({
  __esModule: true,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', permissions: ['translation:create'] };
    next();
  },
  checkPermission: (permission: string) => (req: any, res: any, next: any) => {
    const allowed = checkPermissionMock(permission, req.user);
    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const translationRouter = require('../translation').default;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/translation', translationRouter);
  return app;
};

describe('routes/translation', () => {
  beforeEach(() => {
    translateTextMock.mockReset();
    checkPermissionMock.mockReset();
    checkPermissionMock.mockReturnValue(true);
  });

  it('translates text on the success path', async () => {
    translateTextMock.mockResolvedValue({
      translatedText: 'Hola mundo',
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });

    const res = await request(buildApp())
      .post('/translation')
      .send({ text: 'Hello world', targetLanguage: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ translatedText: 'Hola mundo' })
    );
    expect(translateTextMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a request with missing required fields', async () => {
    const res = await request(buildApp())
      .post('/translation')
      .send({ targetLanguage: 'es' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  it('rejects a request when the permission check fails', async () => {
    checkPermissionMock.mockReturnValue(false);

    const res = await request(buildApp())
      .post('/translation')
      .send({ text: 'Hello world', targetLanguage: 'es' });

    expect(res.status).toBe(403);
    expect(translateTextMock).not.toHaveBeenCalled();
  });
});
