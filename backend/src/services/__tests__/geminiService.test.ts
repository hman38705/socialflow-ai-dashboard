/**
 * Unit tests for geminiService
 *
 * Covers:
 *  1. API key initialization — NOT_CONFIGURED error when no key is set
 *  2. Prompt formatting — image size validation (byte calculation from base64)
 *  3. Error propagation — GeminiServiceError and ValidationError codes surface correctly
 */

import { analyzeImage, GeminiServiceError, ValidationError } from '../geminiService';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/** Build a base64 string that decodes to exactly `bytes` bytes. */
function base64OfBytes(bytes: number): string {
  const remainder = bytes % 3;
  const fullGroups = Math.floor(bytes / 3);
  const padding = remainder === 0 ? 0 : 3 - remainder;
  const dataChars = fullGroups * 4 + (remainder > 0 ? 4 : 0);
  return 'A'.repeat(dataChars - padding) + '='.repeat(padding);
}

// ---------------------------------------------------------------------------
// API key initialization
// ---------------------------------------------------------------------------
describe('geminiService — API key initialization', () => {
  it('throws GeminiServiceError with code NOT_CONFIGURED when no API key is set', async () => {
    // Regardless of valid image data the service has no key configured
    const imageData = base64OfBytes(1024); // 1 KB — well within limit
    await expect(analyzeImage(imageData)).rejects.toThrow(GeminiServiceError);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('NOT_CONFIGURED error carries the expected message text', async () => {
    const imageData = base64OfBytes(512);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({
      message: expect.stringMatching(/api key not configured/i),
    });
  });

  it('error name is GeminiServiceError', async () => {
    const imageData = base64OfBytes(512);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({
      name: 'GeminiServiceError',
    });
  });

  it('default mimeType does not affect the NOT_CONFIGURED path', async () => {
    const imageData = base64OfBytes(512);
    // Default mimeType is image/jpeg — explicit argument should behave the same
    await expect(analyzeImage(imageData, 'image/png')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('optional context argument does not affect the NOT_CONFIGURED path', async () => {
    const imageData = base64OfBytes(512);
    await expect(analyzeImage(imageData, 'image/jpeg', 'some context')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });
});

// ---------------------------------------------------------------------------
// Prompt formatting — image size / byte-calculation logic
// ---------------------------------------------------------------------------
describe('geminiService — prompt formatting (image size validation)', () => {
  it('accepts an image of exactly 1 byte (minimal valid payload)', async () => {
    const imageData = base64OfBytes(1);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('accepts an image 1 byte below the 20 MB limit', async () => {
    const imageData = base64OfBytes(MAX_BYTES - 1);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('accepts an image exactly at the 20 MB limit', async () => {
    const imageData = base64OfBytes(MAX_BYTES);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('rejects an image 1 byte above the 20 MB limit', async () => {
    const imageData = base64OfBytes(MAX_BYTES + 1);
    await expect(analyzeImage(imageData)).rejects.toThrow(ValidationError);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a clearly oversized image (21 MB)', async () => {
    const imageData = base64OfBytes(21 * 1024 * 1024);
    await expect(analyzeImage(imageData)).rejects.toThrow(ValidationError);
  });

  it('validation error message references the byte size', async () => {
    const oversizeBytes = MAX_BYTES + 1024;
    const imageData = base64OfBytes(oversizeBytes);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({
      message: expect.stringContaining('bytes'),
    });
  });

  it('correctly strips base64 padding when calculating byte size (== padding)', async () => {
    // A base64 string with == padding means 1 byte of padding removed
    // Image of size N%3===1: produces ==
    const bytesWithTwoPad = 4; // 4 % 3 === 1 → 2 padding chars
    const imageData = base64OfBytes(bytesWithTwoPad);
    expect(imageData.endsWith('==')).toBe(true);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('correctly handles base64 with single = padding (N%3===2)', async () => {
    const bytesWithOnePad = 5; // 5 % 3 === 2 → 1 padding char
    const imageData = base64OfBytes(bytesWithOnePad);
    expect(imageData.endsWith('=')).toBe(true);
    await expect(analyzeImage(imageData)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

// ---------------------------------------------------------------------------
// Error propagation — class hierarchy and properties
// ---------------------------------------------------------------------------
describe('geminiService — error propagation', () => {
  it('GeminiServiceError is an instance of Error', async () => {
    const imageData = base64OfBytes(512);
    try {
      await analyzeImage(imageData);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(GeminiServiceError);
    }
  });

  it('ValidationError is an instance of GeminiServiceError', () => {
    const err = new ValidationError('test');
    expect(err).toBeInstanceOf(GeminiServiceError);
    expect(err).toBeInstanceOf(Error);
  });

  it('ValidationError has code VALIDATION_ERROR', () => {
    const err = new ValidationError('too large');
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('ValidationError name is ValidationError', () => {
    const err = new ValidationError('too large');
    expect(err.name).toBe('ValidationError');
  });

  it('GeminiServiceError preserves the message passed to it', () => {
    const err = new GeminiServiceError('custom message', 'SOME_CODE');
    expect(err.message).toBe('custom message');
    expect(err.code).toBe('SOME_CODE');
  });

  it('oversized image throws ValidationError before reaching the API key check', async () => {
    // ValidationError should be thrown first (size check runs before key check)
    const imageData = base64OfBytes(MAX_BYTES + 1);
    const rejection = analyzeImage(imageData);
    await expect(rejection).rejects.toBeInstanceOf(ValidationError);
    // Specifically NOT a plain GeminiServiceError with NOT_CONFIGURED
    await expect(analyzeImage(imageData)).rejects.not.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('errors thrown by analyzeImage are always instances of GeminiServiceError', async () => {
    // Both NOT_CONFIGURED and VALIDATION_ERROR should share the same base class
    const smallImage = base64OfBytes(100);
    const hugeImage = base64OfBytes(MAX_BYTES + 1);

    const [smallErr, hugeErr] = await Promise.allSettled([
      analyzeImage(smallImage),
      analyzeImage(hugeImage),
    ]);

    expect(smallErr.status).toBe('rejected');
    expect(hugeErr.status).toBe('rejected');

    if (smallErr.status === 'rejected') {
      expect(smallErr.reason).toBeInstanceOf(GeminiServiceError);
    }
    if (hugeErr.status === 'rejected') {
      expect(hugeErr.reason).toBeInstanceOf(GeminiServiceError);
    }
  });
});
