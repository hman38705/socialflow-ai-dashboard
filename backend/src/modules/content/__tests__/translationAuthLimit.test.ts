import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';

jest.mock('../../../config/config', () => ({ config: { JWT_SECRET } }));

jest.mock('../../../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    keyFromPayload: jest.fn(() => 'key'),
    isBlacklisted: jest.fn(async () => false),
  },
}));

const mockTranslate = jest.fn();
jest.mock('../../../services/TranslationService', () => ({
  translationService: {
    translate: (...args: any[]) => mockTranslate(...args),
    getSupportedLanguages: () => [],
  },
}));

import router from '../routes.translation';

const app = express();
app.use(express.json());
app.use('/api/translation', router);

const token = () => jwt.sign({ sub: 'user-1', userId: 'user-1', id: 'user-1' }, JWT_SECRET);

describe('translation module routes', () => {
  beforeEach(() => mockTranslate.mockReset());

  it('returns 401 for POST /translate without an auth header', async () => {
    const res = await request(app)
      .post('/api/translation/translate')
      .send({ text: 'hi', targetLanguages: ['es'] });
    expect(res.status).toBe(401);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('rejects an oversized /batch request before any upstream call', async () => {
    const texts = Array.from({ length: 1000 }, (_, i) => `text ${i}`);
    const res = await request(app)
      .post('/api/translation/batch')
      .set('Authorization', `Bearer ${token()}`)
      .send({ texts, targetLanguages: ['es'] });
    expect(res.status).toBe(400);
    expect(mockTranslate).not.toHaveBeenCalled();
  });
});
