/**
 * Regression tests for #1774 — POST /ai/analyze-image input validation.
 *
 * Verifies:
 *  1. Missing imageData → 422
 *  2. Invalid mimeType → 422
 *  3. context exceeding 500 chars → 422
 *  4. Valid request passes through to analyzeImage
 */

jest.mock('../../services/geminiService', () => ({
  analyzeImage: jest.fn().mockResolvedValue('A caption'),
  GeminiServiceError: class GeminiServiceError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'GeminiServiceError';
      this.code = code;
    }
  },
}));

jest.mock('../../middleware/authenticate', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user' };
    next();
  },
}));

jest.mock('../../middleware/checkPermission', () => ({
  checkPermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/rateLimit', () => ({
  aiImageLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../config/config', () => ({
  config: {
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    DATABASE_URL: 'postgresql://test',
    TWITTER_API_KEY: 'test',
    TWITTER_API_SECRET: 'test',
  },
}));

import request from 'supertest';
import express from 'express';
import aiRouter from '../ai';

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/ai', aiRouter);

describe('POST /ai/analyze-image — input validation (#1774)', () => {
  it('rejects a request missing imageData with 422', async () => {
    const res = await request(app).post('/ai/analyze-image').send({ mimeType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'imageData' })]),
    );
  });

  it('rejects an unlisted mimeType with 422', async () => {
    const res = await request(app)
      .post('/ai/analyze-image')
      .send({ imageData: 'base64data', mimeType: 'image/bmp' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'mimeType' })]),
    );
  });

  it('rejects context exceeding 500 characters with 422', async () => {
    const res = await request(app)
      .post('/ai/analyze-image')
      .send({
        imageData: 'base64data',
        context: 'x'.repeat(501),
      });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'context' })]),
    );
  });

  it('accepts a valid request and returns a caption', async () => {
    const res = await request(app).post('/ai/analyze-image').send({
      imageData: 'dGVzdA==',
      mimeType: 'image/png',
      context: 'a sunset photo',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ caption: 'A caption' });
  });

  it('accepts a request with default mimeType when omitted', async () => {
    const res = await request(app).post('/ai/analyze-image').send({
      imageData: 'dGVzdA==',
    });

    expect(res.status).toBe(200);
  });
});
