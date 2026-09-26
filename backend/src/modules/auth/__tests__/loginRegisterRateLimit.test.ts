import express from 'express';
import request from 'supertest';

process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '3';

jest.mock('../controllers/auth', () => {
  const ok = (_req: any, res: any) => res.status(200).json({ ok: true });
  return { register: ok, login: ok, refresh: ok, logout: ok, changePassword: ok };
});
jest.mock('../../../middleware/authenticate', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../../services/SSETicketService', () => ({
  sseTicketService: { generateTicket: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../routes').default;

const app = express();
app.use(express.json());
app.use('/api/auth', router);

const body = { email: 'user@example.com', password: 'Password123!' };

describe('auth login/register rate limiting', () => {
  it('returns 429 on the (N+1)th POST /api/auth/login and leaves earlier attempts alone', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/api/auth/login').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('throttles POST /api/auth/register as well', async () => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(429);
  });
});
