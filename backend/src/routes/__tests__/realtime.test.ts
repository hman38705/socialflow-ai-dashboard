import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import realtimeRouter from '../realtime';
import { sseTicketService } from '../../services/sseTicketService';

jest.mock('../../services/sseTicketService', () => ({
  sseTicketService: {
    issueTicket: jest.fn(),
    validateTicket: jest.fn(),
  },
}));

const mockedTicketService = sseTicketService as jest.Mocked<
  typeof sseTicketService
>;

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function buildApp(): express.Express {
  const app = express();
  app.use('/realtime', realtimeRouter);
  return app;
}

describe('realtime route (SSE ticket issuance)', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('issues a ticket for an authenticated user', async () => {
    const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET);
    mockedTicketService.issueTicket.mockReturnValue('ticket-abc');

    const res = await request(app)
      .post('/realtime/ticket')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticket: 'ticket-abc' });
    expect(mockedTicketService.issueTicket).toHaveBeenCalledWith('user-1');
  });

  it('rejects a request with a malformed JWT', async () => {
    const res = await request(app)
      .post('/realtime/ticket')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(res.status).toBe(401);
    expect(mockedTicketService.issueTicket).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).post('/realtime/ticket');

    expect(res.status).toBe(401);
    expect(mockedTicketService.issueTicket).not.toHaveBeenCalled();
  });

  it('accepts a valid ticket on the SSE connection', async () => {
    mockedTicketService.validateTicket.mockReturnValue(true);

    const res = await request(app).get('/realtime/stream?ticket=valid-ticket');

    expect(mockedTicketService.validateTicket).toHaveBeenCalledWith(
      'valid-ticket'
    );
    expect(res.status).not.toBe(401);
  });

  it('rejects an expired ticket on the SSE connection', async () => {
    mockedTicketService.validateTicket.mockReturnValue(false);

    const res = await request(app).get('/realtime/stream?ticket=expired-ticket');

    expect(res.status).toBe(401);
  });

  it('rejects an invalid ticket on the SSE connection', async () => {
    mockedTicketService.validateTicket.mockReturnValue(false);

    const res = await request(app).get('/realtime/stream?ticket=bogus');

    expect(res.status).toBe(401);
  });
});
