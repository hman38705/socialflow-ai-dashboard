import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { verifySignature, rawBodyMiddleware } from '../middleware/verifySignature';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SECRET = 'test-signing-secret';
const ALGORITHM = 'sha256';

function makeTimestamp(offsetMs = 0): string {
  return String(Math.floor((Date.now() + offsetMs) / 1000));
}

function makeSignature(timestamp: string, body: string, secret = SECRET): string {
  const payload = `${timestamp}.${body}`;
  return `${ALGORITHM}=` + crypto.createHmac(ALGORITHM, secret).update(payload).digest('hex');
}

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    path: '/test',
    method: 'POST',
    on: jest.fn(),
    ...overrides,
  } as unknown as Request;
}

function buildRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, setHeader: jest.fn() } as unknown as Response, status, json };
}

const next: NextFunction = jest.fn();

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------
describe('verifySignature', () => {
  const middleware = verifySignature({ getSecret: () => SECRET });

  function makeValidReq(body = '{"event":"test"}', offsetMs = 0): Request {
    const ts = makeTimestamp(offsetMs);
    const sig = makeSignature(ts, body);
    return buildReq({
      headers: { 'x-timestamp': ts, 'x-signature': sig },
      rawBody: Buffer.from(body),
    } as any);
  }

  it('calls next() for a valid signature', async () => {
    const req = makeValidReq();
    const { res } = buildRes();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when x-timestamp header is missing', async () => {
    const ts = makeTimestamp();
    const body = '{"event":"test"}';
    const sig = makeSignature(ts, body);
    const req = buildReq({
      headers: { 'x-signature': sig },
      rawBody: Buffer.from(body),
    } as any);
    const { res, status, json } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Missing timestamp' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing timestamp before computing the HMAC, even with a stale replayed signature', async () => {
    // A signature computed for a timestamp far in the past must still be rejected
    // for the *missing timestamp* reason, never reaching HMAC comparison.
    const staleTs = makeTimestamp(-365 * 24 * 60 * 60 * 1000);
    const body = '{"event":"test"}';
    const sig = makeSignature(staleTs, body);
    const req = buildReq({
      headers: { 'x-signature': sig },
      rawBody: Buffer.from(body),
    } as any);
    const { res, status, json } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Missing timestamp' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when x-signature header is missing', async () => {
    const ts = makeTimestamp();
    const req = buildReq({
      headers: { 'x-timestamp': ts },
      rawBody: Buffer.from('{}'),
    } as any);
    const { res, status } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a timestamp outside the tolerance window (replay attack)', async () => {
    // 10 minutes in the past
    const req = makeValidReq('{"event":"test"}', -(10 * 60 * 1000));
    const { res, status, json } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TIMESTAMP_EXPIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a non-numeric timestamp', async () => {
    const req = buildReq({
      headers: { 'x-timestamp': 'not-a-number', 'x-signature': 'sha256=abc' },
      rawBody: Buffer.from('{}'),
    } as any);
    const { res, status, json } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TIMESTAMP' }));
  });

  it('returns 401 when the signature does not match', async () => {
    const ts = makeTimestamp();
    const req = buildReq({
      headers: { 'x-timestamp': ts, 'x-signature': 'sha256=badhash' },
      rawBody: Buffer.from('{"event":"test"}'),
    } as any);
    const { res, status, json } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_SIGNATURE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when getSecret returns null', async () => {
    const noSecretMiddleware = verifySignature({ getSecret: () => null });
    const req = makeValidReq();
    const { res, status, json } = buildRes();
    await noSecretMiddleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_SIGNING_SECRET' }));
  });

  it('returns 500 when rawBody is not set (middleware misconfiguration)', async () => {
    const ts = makeTimestamp();
    const sig = makeSignature(ts, '{}');
    const req = buildReq({ headers: { 'x-timestamp': ts, 'x-signature': sig } } as any);
    const { res, status } = buildRes();
    await middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(500);
  });

  it('respects custom header names', async () => {
    const customMiddleware = verifySignature({
      getSecret: () => SECRET,
      signatureHeader: 'x-hub-signature-256',
      timestampHeader: 'x-request-timestamp',
    });
    const ts = makeTimestamp();
    const body = '{"event":"custom"}';
    const sig = makeSignature(ts, body);
    const req = buildReq({
      headers: { 'x-request-timestamp': ts, 'x-hub-signature-256': sig },
      rawBody: Buffer.from(body),
    } as any);
    const { res } = buildRes();
    await customMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rawBodyMiddleware
// ---------------------------------------------------------------------------
describe('rawBodyMiddleware', () => {
  it('populates req.rawBody and parses req.body', (done: jest.DoneCallback) => {
    const body = JSON.stringify({ hello: 'world' });
    const chunks = [Buffer.from(body)];

    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const req = {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
      },
    } as unknown as Request;
    const res = {} as Response;

    rawBodyMiddleware(req, res, () => {
      expect((req as any).rawBody).toEqual(Buffer.from(body));
      expect(req.body).toEqual({ hello: 'world' });
      done();
    });

    handlers['data'](chunks[0]);
    handlers['end']();
  });

  it('sets req.body to {} for empty body', (done: jest.DoneCallback) => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const req = {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
      },
    } as unknown as Request;

    rawBodyMiddleware(req, {} as Response, () => {
      expect(req.body).toEqual({});
      done();
    });

    handlers['end']();
  });
});
