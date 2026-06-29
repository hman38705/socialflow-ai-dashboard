import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger } from '../lib/logger';

const logger = createLogger('verifySignature');

/**
 * How long (ms) a signed request is considered valid.
 * Requests outside this window are rejected to prevent replay attacks.
 * Default: 5 minutes.
 */
const TIMESTAMP_TOLERANCE_MS = Number(process.env.HMAC_TIMESTAMP_TOLERANCE_MS ?? 5 * 60 * 1000);

export interface VerifySignatureOptions {
  /**
   * Resolve the shared secret for the incoming request.
   * Receives the full request so callers can look up per-webhook secrets.
   * Return null/undefined to reject with 401.
   */
  getSecret: (req: Request) => string | null | undefined | Promise<string | null | undefined>;

  /**
   * Header carrying the HMAC digest.
   * @default 'x-signature'
   */
  signatureHeader?: string;

  /**
   * Header carrying the Unix timestamp (seconds) of when the request was signed.
   * @default 'x-timestamp'
   */
  timestampHeader?: string;

  /**
   * Algorithm passed to crypto.createHmac.
   * @default 'sha256'
   */
  algorithm?: string;
}

/**
 * verifySignature
 *
 * Express middleware that authenticates inbound webhook requests using
 * HMAC request signing.
 *
 * Verification steps:
 *  1. Extract X-Timestamp and X-Signature headers.
 *  2. Reject requests whose timestamp falls outside TIMESTAMP_TOLERANCE_MS
 *     (replay-attack prevention).
 *  3. Resolve the shared secret via the caller-supplied `getSecret` function.
 *  4. Recompute HMAC-<algorithm>("<timestamp>.<rawBody>") and compare with
 *     the supplied signature using a timing-safe comparison.
 *
 * IMPORTANT: This middleware requires the raw request body to be available
 * on `req.rawBody` (Buffer). Mount it on routes that use the `rawBody`
 * express middleware (see example below), NOT after `express.json()`.
 *
 * @example
 * // In your route file:
 * import { rawBodyMiddleware } from '../middleware/verifySignature';
 *
 * router.post(
 *   '/incoming',
 *   rawBodyMiddleware,
 *   verifySignature({ getSecret: () => process.env.WEBHOOK_SECRET }),
 *   handler,
 * );
 */
export function verifySignature(options: VerifySignatureOptions) {
  const {
    getSecret,
    signatureHeader = 'x-signature',
    timestampHeader = 'x-timestamp',
    algorithm = 'sha256',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = (req as any).requestId as string | undefined;

    // ── 1. Extract headers ──────────────────────────────────────────────────
    // The timestamp must be checked before anything else (including HMAC
    // computation) so the replay window can never be bypassed by omitting it.
    const rawTimestamp = req.headers[timestampHeader] as string | undefined;

    if (!rawTimestamp) {
      logger.warn('Missing timestamp header', { requestId, path: req.path, method: req.method });
      res.status(401).json({ error: 'Missing timestamp' });
      return;
    }

    const rawSignature = req.headers[signatureHeader] as string | undefined;

    if (!rawSignature) {
      logger.warn('Missing signature header', { requestId, path: req.path, method: req.method });
      res.status(401).json({
        success: false,
        code: 'MISSING_SIGNATURE_HEADERS',
        message: `Required header '${signatureHeader}' must be present.`,
      });
      return;
    }

    // ── 2. Replay-attack check ──────────────────────────────────────────────
    const timestampMs = Number(rawTimestamp) * 1000; // header is Unix seconds
    if (!Number.isFinite(timestampMs)) {
      logger.warn('Invalid timestamp header', { requestId, path: req.path, rawTimestamp });
      res.status(401).json({
        success: false,
        code: 'INVALID_TIMESTAMP',
        message: 'Timestamp header is not a valid Unix timestamp.',
      });
      return;
    }

    const ageMsMs = Date.now() - timestampMs;
    if (Math.abs(ageMsMs) > TIMESTAMP_TOLERANCE_MS) {
      logger.warn('Request timestamp outside tolerance window', {
        requestId,
        path: req.path,
        ageMs: ageMsMs,
        toleranceMs: TIMESTAMP_TOLERANCE_MS,
      });
      res.status(401).json({
        success: false,
        code: 'TIMESTAMP_EXPIRED',
        message: 'Request timestamp is outside the acceptable window. Possible replay attack.',
      });
      return;
    }

    // ── 3. Resolve secret ───────────────────────────────────────────────────
    const secret = await getSecret(req);
    if (!secret) {
      logger.error('No signing secret resolved for request', {
        requestId,
        path: req.path,
        method: req.method,
      });
      res.status(401).json({
        success: false,
        code: 'MISSING_SIGNING_SECRET',
        message: 'Unable to resolve signing secret for this request.',
      });
      return;
    }

    // ── 4. Compute and compare HMAC ─────────────────────────────────────────
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      logger.error('rawBody not available — mount rawBodyMiddleware before verifySignature', {
        requestId,
        path: req.path,
      });
      res.status(500).json({
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server misconfiguration: raw body unavailable.',
      });
      return;
    }

    const signedPayload = `${rawTimestamp}.${rawBody.toString('utf8')}`;
    const expected =
      `${algorithm}=` + crypto.createHmac(algorithm, secret).update(signedPayload).digest('hex');

    let signaturesMatch: boolean;
    try {
      signaturesMatch = crypto.timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(rawSignature, 'utf8'),
      );
    } catch {
      // Buffers of different lengths — definitely not equal
      signaturesMatch = false;
    }

    if (!signaturesMatch) {
      logger.warn('HMAC signature mismatch', {
        requestId,
        path: req.path,
        method: req.method,
        algorithm,
        signatureHeader,
        // Never log the actual signatures or secret
      });
      res.status(401).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Request signature is invalid.',
      });
      return;
    }

    logger.info('Signature verified', { requestId, path: req.path, method: req.method });
    next();
  };
}

/**
 * rawBodyMiddleware
 *
 * Captures the raw request body as a Buffer on `req.rawBody` while also
 * making the parsed JSON available on `req.body` as usual.
 *
 * Mount this INSTEAD OF `express.json()` on routes that need signature
 * verification.
 */
export function rawBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  let data = Buffer.alloc(0);

  req.on('data', (chunk: Buffer) => {
    data = Buffer.concat([data, chunk]);
  });

  req.on('end', () => {
    (req as any).rawBody = data;
    try {
      req.body = data.length ? JSON.parse(data.toString('utf8')) : {};
    } catch {
      req.body = {};
    }
    next();
  });

  req.on('error', next);
}
