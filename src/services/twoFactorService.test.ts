import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  twoFactorService,
  beginSetup,
  confirmSetup,
  verify,
  verifyRecoveryCode,
  disable,
  regenerateRecoveryCodes,
  normalizeTotpCode,
  normalizeRecoveryCode,
  mapStatusToErrorCode,
  createSafeError,
  TwoFactorLockoutStore,
} from './twoFactorService';
import { ErrorCode } from '../constants/ErrorCodes';
import { AppError } from '../utils/AppError';

describe('twoFactorService (FE-051)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    twoFactorService.setLockoutStore(null);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 1. Normalization & Validation Tests
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Normalization', () => {
    describe('normalizeTotpCode', () => {
      it('returns plain 6-digit code untouched', () => {
        expect(normalizeTotpCode('123456')).toBe('123456');
      });

      it('strips leading, trailing, and embedded spaces', () => {
        expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
        expect(normalizeTotpCode('  1 2 3 4 5 6  ')).toBe('123456');
      });

      it('strips dashes and hyphens', () => {
        expect(normalizeTotpCode('123-456')).toBe('123456');
        expect(normalizeTotpCode('1-2-3-4-5-6')).toBe('123456');
      });

      it('strips combinations of spaces, dashes, and tabs', () => {
        expect(normalizeTotpCode(' 123 - 456 \t')).toBe('123456');
      });

      it('throws AppError(ERR_INVALID_FORMAT) for codes with fewer than 6 digits', () => {
        expect(() => normalizeTotpCode('12345')).toThrow(AppError);
        try {
          normalizeTotpCode('12345');
        } catch (err: any) {
          expect(err.code).toBe(ErrorCode.ERR_INVALID_FORMAT);
        }
      });

      it('throws AppError(ERR_INVALID_FORMAT) for codes with more than 6 digits', () => {
        expect(() => normalizeTotpCode('1234567')).toThrow(AppError);
        try {
          normalizeTotpCode('1234567');
        } catch (err: any) {
          expect(err.code).toBe(ErrorCode.ERR_INVALID_FORMAT);
        }
      });

      it('throws AppError(ERR_INVALID_FORMAT) for non-numeric characters', () => {
        expect(() => normalizeTotpCode('12345a')).toThrow(AppError);
        expect(() => normalizeTotpCode('abcdef')).toThrow(AppError);
      });

      it('throws AppError(ERR_INVALID_FORMAT) for empty or whitespace strings', () => {
        expect(() => normalizeTotpCode('')).toThrow(AppError);
        expect(() => normalizeTotpCode('   ')).toThrow(AppError);
        expect(() => normalizeTotpCode('---')).toThrow(AppError);
      });

      it('throws AppError(ERR_INVALID_FORMAT) for non-string inputs', () => {
        expect(() => normalizeTotpCode(null)).toThrow(AppError);
        expect(() => normalizeTotpCode(undefined)).toThrow(AppError);
        expect(() => normalizeTotpCode(123456)).toThrow(AppError);
      });
    });

    describe('normalizeRecoveryCode', () => {
      it('uppercases lowercase characters', () => {
        expect(normalizeRecoveryCode('abcd1234ef')).toBe('ABCD1234EF');
      });

      it('strips dashes and spaces', () => {
        expect(normalizeRecoveryCode('abcd-1234-efgh')).toBe('ABCD1234EFGH');
        expect(normalizeRecoveryCode('  abcd - 1234  ')).toBe('ABCD1234');
      });

      it('handles standard format recovery codes', () => {
        expect(normalizeRecoveryCode('XXXX-0000-YYYY')).toBe('XXXX0000YYYY');
      });

      it('throws AppError(ERR_INVALID_FORMAT) for empty or whitespace strings', () => {
        expect(() => normalizeRecoveryCode('')).toThrow(AppError);
        expect(() => normalizeRecoveryCode('   ')).toThrow(AppError);
        expect(() => normalizeRecoveryCode('---')).toThrow(AppError);
      });

      it('throws AppError(ERR_INVALID_FORMAT) for special characters', () => {
        expect(() => normalizeRecoveryCode('abc!@#123')).toThrow(AppError);
        expect(() => normalizeRecoveryCode('code_123')).toThrow(AppError);
      });

      it('throws AppError(ERR_INVALID_FORMAT) for non-string inputs', () => {
        expect(() => normalizeRecoveryCode(null)).toThrow(AppError);
        expect(() => normalizeRecoveryCode(undefined)).toThrow(AppError);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 2. Secret Leak Prevention Tests
  // ═════════════════════════════════════════════════════════════════════════════

  describe('No secret-bearing values in thrown error messages', () => {
    const sensitiveSecret = 'SECRET_KEY_JBSWY3DPEHPK3PXP';
    const sensitiveTotpCode = '987654';
    const sensitiveRecoveryCode = 'REC-SECRET-1234';
    const sensitivePassword = 'P@ssw0rd_Super_Sensitive!';

    it('normalizeTotpCode never exposes the input code in error message on invalid format', () => {
      try {
        normalizeTotpCode(sensitiveTotpCode + 'invalid');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveTotpCode);
        expect(err.message).not.toContain('invalid');
      }
    });

    it('normalizeRecoveryCode never exposes the input code in error message on invalid chars', () => {
      try {
        normalizeRecoveryCode(sensitiveRecoveryCode + '$$$');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveRecoveryCode);
        expect(err.message).not.toContain('$$$');
      }
    });

    it('confirmSetup never includes sensitive code when server rejects with 401', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: `Invalid code: ${sensitiveTotpCode}` }),
      });

      try {
        await twoFactorService.confirmSetup(sensitiveTotpCode);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveTotpCode);
        expect(err.message).not.toContain('Invalid code:');
        expect(err.code).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
      }
    });

    it('verify never includes sensitive TOTP code when server fails with 400', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: `Failed verification for code ${sensitiveTotpCode}` }),
      });

      try {
        await twoFactorService.verify(sensitiveTotpCode);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveTotpCode);
        expect(err.code).toBe(ErrorCode.ERR_BAD_REQUEST);
      }
    });

    it('verifyRecoveryCode never includes sensitive recovery code when server returns 401', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: `Recovery code ${sensitiveRecoveryCode} not found` }),
      });

      try {
        await twoFactorService.verifyRecoveryCode(sensitiveRecoveryCode);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveRecoveryCode);
        expect(err.message).not.toContain('REC-SECRET-1234');
        expect(err.message).not.toContain('RECSECRET1234');
        expect(err.code).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
      }
    });

    it('disable never includes password in error when password is empty or invalid', async () => {
      try {
        await twoFactorService.disable('');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.ERR_MISSING_PARAMETERS);
      }
    });

    it('disable never includes password when server rejects with 401 incorrect password', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: `Wrong password ${sensitivePassword}` }),
      });

      try {
        await twoFactorService.disable(sensitivePassword);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitivePassword);
        expect(err.code).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
      }
    });

    it('network errors never leak sensitive request bodies in the message', async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError(`Failed to fetch for ${sensitiveSecret}`));

      try {
        await twoFactorService.confirmSetup(sensitiveTotpCode);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveSecret);
        expect(err.message).not.toContain(sensitiveTotpCode);
        expect(err.code).toBe(ErrorCode.ERR_NETWORK_ERROR);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 3. Error Mapping Tests
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Error Mapping', () => {
    it('maps HTTP status codes to standard ErrorCode values', () => {
      expect(mapStatusToErrorCode(400)).toBe(ErrorCode.ERR_BAD_REQUEST);
      expect(mapStatusToErrorCode(401)).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
      expect(mapStatusToErrorCode(403)).toBe(ErrorCode.ERR_FORBIDDEN);
      expect(mapStatusToErrorCode(404)).toBe(ErrorCode.ERR_NOT_FOUND);
      expect(mapStatusToErrorCode(409)).toBe(ErrorCode.ERR_RESOURCE_EXISTS);
      expect(mapStatusToErrorCode(422)).toBe(ErrorCode.ERR_VALIDATION_FAILED);
      expect(mapStatusToErrorCode(429)).toBe(ErrorCode.ERR_MAX_RETRIES_EXCEEDED);
      expect(mapStatusToErrorCode(500)).toBe(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
      expect(mapStatusToErrorCode(503)).toBe(ErrorCode.ERR_NETWORK_ERROR);
    });

    it('createSafeError produces valid AppError instances with correct status codes', () => {
      const err = createSafeError(401);
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
      expect(err.statusCode).toBe(401);
    });

    it('createSafeError preserves valid ErrorCode enum values', () => {
      const err = createSafeError(ErrorCode.ERR_AUTH_REQUIRED);
      expect(err.code).toBe(ErrorCode.ERR_AUTH_REQUIRED);
      expect(err.statusCode).toBe(401);
    });

    it('maps server response containing recognized code field', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ code: ErrorCode.ERR_RESOURCE_EXISTS }),
      });

      try {
        await twoFactorService.beginSetup();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.ERR_RESOURCE_EXISTS);
      }
    });

    it('maps 429 rate limit errors to ERR_MAX_RETRIES_EXCEEDED', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Rate limit reached' }),
      });

      try {
        await twoFactorService.verify('123456');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.ERR_MAX_RETRIES_EXCEEDED);
      }
    });

    it('maps network failures to ERR_NETWORK_ERROR', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network request failed'));

      try {
        await twoFactorService.beginSetup();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.ERR_NETWORK_ERROR);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 4. Service Method Contracts & Transport
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Service Methods Contract', () => {
    it('beginSetup calls POST /api/auth/2fa/setup and validates response shape', async () => {
      const mockSetupResponse = {
        secret: 'JBSWY3DPEHPK3PXP',
        qrCodeDataUrl: 'data:image/png;base64,mockqr',
        uri: 'otpauth://totp/SocialFlow:user?secret=JBSWY3DPEHPK3PXP',
        recoveryCodes: ['CODE1', 'CODE2'],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSetupResponse,
      });

      const result = await beginSetup();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/setup',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(result).toEqual(mockSetupResponse);
    });

    it('beginSetup throws ERR_INVALID_FORMAT if server response lacks secret', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ qrCodeDataUrl: 'data:image/png;base64,mockqr' }),
      });

      await expect(beginSetup()).rejects.toMatchObject({
        code: ErrorCode.ERR_INVALID_FORMAT,
      });
    });

    it('confirmSetup normalizes code before sending and returns recovery codes', async () => {
      const mockConfirmResponse = {
        recoveryCodes: ['REC1', 'REC2', 'REC3'],
        success: true,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockConfirmResponse,
      });

      const result = await confirmSetup('  123 - 456  ');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/verify-setup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ code: '123456' }),
        }),
      );
      expect(result.recoveryCodes).toEqual(['REC1', 'REC2', 'REC3']);
      expect(result.success).toBe(true);
    });

    it('verify normalizes code, passes challengeToken, and returns auth tokens', async () => {
      const mockTokens = {
        accessToken: 'access_jwt_123',
        refreshToken: 'refresh_jwt_456',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTokens,
      });

      const result = await verify(' 654 - 321 ', 'challenge_session_abc');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/verify',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            code: '654321',
            mode: 'totp',
            challengeToken: 'challenge_session_abc',
          }),
        }),
      );
      expect(result).toEqual(mockTokens);
    });

    it('verify throws ERR_INVALID_FORMAT if response lacks tokens', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });

      await expect(verify('123456')).rejects.toMatchObject({
        code: ErrorCode.ERR_INVALID_FORMAT,
      });
    });

    it('verifyRecoveryCode normalizes recovery code and sends recovery mode', async () => {
      const mockTokens = {
        accessToken: 'access_token_rec',
        refreshToken: 'refresh_token_rec',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTokens,
      });

      const result = await verifyRecoveryCode('  abcd - 1234 - efgh  ', 'challenge_xyz');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/verify',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            code: 'ABCD1234EFGH',
            mode: 'recovery',
            challengeToken: 'challenge_xyz',
          }),
        }),
      );
      expect(result).toEqual(mockTokens);
    });

    it('disable sends account password to POST /api/auth/2fa/disable', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await disable('UserValidPassword123!');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/disable',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'UserValidPassword123!' }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('disable throws ERR_MISSING_PARAMETERS when password is missing', async () => {
      await expect(disable('')).rejects.toMatchObject({
        code: ErrorCode.ERR_MISSING_PARAMETERS,
      });
    });

    it('regenerateRecoveryCodes calls POST /api/auth/2fa/recovery-codes/regenerate', async () => {
      const mockRegenResponse = {
        recoveryCodes: ['NEW1', 'NEW2', 'NEW3', 'NEW4'],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockRegenResponse,
      });

      const result = await regenerateRecoveryCodes();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/recovery-codes/regenerate',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(result.recoveryCodes).toEqual(['NEW1', 'NEW2', 'NEW3', 'NEW4']);
    });

    it('includes Authorization header from localStorage when token exists', async () => {
      localStorage.setItem('accessToken', 'my_saved_access_token');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          secret: 'JBSWY3DPEHPK3PXP',
        }),
      });

      await beginSetup();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/setup',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my_saved_access_token',
          }),
        }),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 5. Pluggable Lockout Store Tests (Backend / Redis compatibility)
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Pluggable Lockout Store', () => {
    it('delegates lockout operations to store when configured', async () => {
      const mockStore: TwoFactorLockoutStore = {
        recordFailedAttempt: vi.fn(),
        isLockedOut: vi.fn().mockResolvedValue(true),
        getLockoutRemainingMs: vi.fn().mockResolvedValue(120_000),
        resetFailedAttempts: vi.fn(),
      };

      twoFactorService.setLockoutStore(mockStore);

      await twoFactorService.recordFailedAttempt('user-1');
      expect(mockStore.recordFailedAttempt).toHaveBeenCalledWith('user-1');

      const locked = await twoFactorService.isLockedOut('user-1');
      expect(locked).toBe(true);
      expect(mockStore.isLockedOut).toHaveBeenCalledWith('user-1');

      const remaining = await twoFactorService.getLockoutRemainingMs('user-1');
      expect(remaining).toBe(120_000);
      expect(mockStore.getLockoutRemainingMs).toHaveBeenCalledWith('user-1');

      await twoFactorService.resetFailedAttempts('user-1');
      expect(mockStore.resetFailedAttempts).toHaveBeenCalledWith('user-1');
    });

    it('returns false/0 safely when no lockout store is registered', async () => {
      expect(await twoFactorService.isLockedOut('user-1')).toBe(false);
      expect(await twoFactorService.getLockoutRemainingMs('user-1')).toBe(0);
    });
  });
});
