/**
 * FE-051: Two-Factor Authentication Client Service
 *
 * Provides a thin, typed wrapper around server-side 2FA endpoints:
 * - beginSetup(): Initiates 2FA setup and returns server-generated secret and QR code.
 * - confirmSetup(code): Confirms and enables 2FA with a 6-digit TOTP code.
 * - verify(code, challengeToken?): Verifies 2FA TOTP code for authentication challenges.
 * - verifyRecoveryCode(code, challengeToken?): Verifies a backup recovery code.
 * - disable(password): Disables 2FA using the account password.
 * - regenerateRecoveryCodes(): Requests a new set of recovery codes from the server.
 *
 * Security & Design Guarantees:
 * - All cryptography, TOTP verification, and secret generation are performed strictly server-side.
 * - Frontend code contains no otplib or WebCrypto secret generation logic.
 * - Codes are normalized (spaces/dashes stripped, recovery codes converted to uppercase) before transport.
 * - All errors thrown are AppError instances mapped to centralized ErrorCode constants.
 * - Thrown error messages never contain secrets, codes, or raw unvetted server strings.
 */

import { ErrorCode } from '../constants/ErrorCodes';
import { AppError } from '../utils/AppError';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TwoFactorSetupResult {
  secret: string;
  qrCodeDataUrl?: string;
  uri?: string;
  recoveryCodes?: string[];
}

export interface TwoFactorConfirmResult {
  recoveryCodes: string[];
  success?: boolean;
}

export interface TwoFactorVerifyResult {
  accessToken: string;
  refreshToken: string;
  user?: Record<string, unknown>;
}

export interface TwoFactorDisableResult {
  success: boolean;
  message?: string;
}

export interface TwoFactorRegenerateResult {
  recoveryCodes: string[];
}

export interface TwoFactorLockoutStore {
  recordFailedAttempt(userId: string): Promise<void> | void;
  isLockedOut(userId: string): Promise<boolean> | boolean;
  getLockoutRemainingMs(userId: string): Promise<number> | number;
  resetFailedAttempts(userId: string): Promise<void> | void;
}

// ─── Normalization & Validation Helpers ────────────────────────────────────────

/**
 * Normalizes a 6-digit TOTP code by stripping whitespace and hyphens/dashes.
 * Validates that the normalized code contains exactly 6 numeric digits.
 * Throws an AppError with ErrorCode.ERR_INVALID_FORMAT if invalid.
 *
 * Note: The thrown error message never includes the input code.
 */
export function normalizeTotpCode(code: unknown): string {
  if (typeof code !== 'string') {
    throw new AppError(
      ErrorCode.ERR_INVALID_FORMAT,
      'Invalid verification code format: expected a 6-digit numeric string',
    );
  }

  const cleaned = code.replace(/[\s-]+/g, '');
  if (!/^\d{6}$/.test(cleaned)) {
    throw new AppError(
      ErrorCode.ERR_INVALID_FORMAT,
      'Invalid verification code format: code must be exactly 6 digits',
    );
  }

  return cleaned;
}

/**
 * Normalizes a recovery code by stripping whitespace and hyphens/dashes, and uppercasing.
 * Validates that the normalized code is a non-empty alphanumeric string.
 * Throws an AppError with ErrorCode.ERR_INVALID_FORMAT if invalid.
 *
 * Note: The thrown error message never includes the input code.
 */
export function normalizeRecoveryCode(code: unknown): string {
  if (typeof code !== 'string') {
    throw new AppError(
      ErrorCode.ERR_INVALID_FORMAT,
      'Invalid recovery code format: expected a non-empty string',
    );
  }

  const cleaned = code.replace(/[\s-]+/g, '').toUpperCase();
  if (!cleaned || !/^[A-Z0-9]+$/.test(cleaned)) {
    throw new AppError(
      ErrorCode.ERR_INVALID_FORMAT,
      'Invalid recovery code format: code must contain only alphanumeric characters',
    );
  }

  return cleaned;
}

// ─── Error Mapping ─────────────────────────────────────────────────────────────

const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.ERR_AUTH_REQUIRED]: 'Authentication is required.',
  [ErrorCode.ERR_AUTH_EXPIRED]: 'Authentication session has expired.',
  [ErrorCode.ERR_INVALID_CREDENTIALS]: 'Invalid credentials or two-factor code.',
  [ErrorCode.ERR_FORBIDDEN]: 'Access to two-factor service is forbidden.',
  [ErrorCode.ERR_INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions for two-factor operation.',
  [ErrorCode.ERR_NOT_FOUND]: 'Two-factor resource not found.',
  [ErrorCode.ERR_RESOURCE_EXISTS]: 'Two-factor authentication is already configured.',
  [ErrorCode.ERR_BAD_REQUEST]: 'Bad request to two-factor service.',
  [ErrorCode.ERR_VALIDATION_FAILED]: 'Two-factor validation failed.',
  [ErrorCode.ERR_MISSING_PARAMETERS]: 'Required parameter is missing.',
  [ErrorCode.ERR_INVALID_FORMAT]: 'Invalid two-factor code format.',
  [ErrorCode.ERR_PAYMENT_REQUIRED]: 'Payment required.',
  [ErrorCode.ERR_INSUFFICIENT_FUNDS]: 'Insufficient funds.',
  [ErrorCode.ERR_TRANSACTION_FAILED]: 'Transaction failed.',
  [ErrorCode.ERR_TRANSACTION_EXPIRED]: 'Transaction expired.',
  [ErrorCode.ERR_TRANSACTION_NOT_SIGNED]: 'Transaction not signed.',
  [ErrorCode.ERR_BLOCKCHAIN_UNAVAILABLE]: 'Blockchain service is unavailable.',
  [ErrorCode.ERR_NETWORK_ERROR]: 'Network error while communicating with two-factor service.',
  [ErrorCode.ERR_WALLET_NOT_CONNECTED]: 'Wallet not connected.',
  [ErrorCode.ERR_WALLET_NOT_AVAILABLE]: 'Wallet not available.',
  [ErrorCode.ERR_DATABASE_NOT_INITIALIZED]: 'Database not initialized.',
  [ErrorCode.ERR_DATABASE_ERROR]: 'Database error.',
  [ErrorCode.ERR_INTERNAL_SERVER_ERROR]: 'An internal server error occurred in two-factor service.',
  [ErrorCode.ERR_NOT_IMPLEMENTED]: 'Two-factor functionality is not implemented.',
  [ErrorCode.ERR_MAX_RETRIES_EXCEEDED]:
    'Too many attempts. Rate limit exceeded. Please try again later.',
};

/**
 * Maps an HTTP status code to an ErrorCode enum value.
 */
export function mapStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.ERR_BAD_REQUEST;
    case 401:
      return ErrorCode.ERR_INVALID_CREDENTIALS;
    case 403:
      return ErrorCode.ERR_FORBIDDEN;
    case 404:
      return ErrorCode.ERR_NOT_FOUND;
    case 409:
      return ErrorCode.ERR_RESOURCE_EXISTS;
    case 422:
      return ErrorCode.ERR_VALIDATION_FAILED;
    case 429:
      return ErrorCode.ERR_MAX_RETRIES_EXCEEDED;
    case 503:
      return ErrorCode.ERR_NETWORK_ERROR;
    case 500:
    case 502:
    case 504:
    default:
      return ErrorCode.ERR_INTERNAL_SERVER_ERROR;
  }
}

/**
 * Creates an AppError from an ErrorCode or HTTP status code with a safe, curated message.
 * Ensures raw server error strings and secret values are never included in the thrown error.
 */
export function createSafeError(
  statusOrCode: number | ErrorCode,
  fallbackMessage?: string,
): AppError {
  let code: ErrorCode;
  if (typeof statusOrCode === 'number') {
    code = mapStatusToErrorCode(statusOrCode);
  } else if (Object.values(ErrorCode).includes(statusOrCode)) {
    code = statusOrCode;
  } else {
    code = ErrorCode.ERR_INTERNAL_SERVER_ERROR;
  }

  const message =
    fallbackMessage || DEFAULT_ERROR_MESSAGES[code] || 'Two-factor authentication error';
  return new AppError(code, message);
}

// ─── HTTP Transport ────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('accessToken') || localStorage.getItem('sf_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request2Fa<T>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const method = options.method || 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...getAuthHeaders(),
  };

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (AppError.isAppError(error)) {
      throw error;
    }
    throw createSafeError(ErrorCode.ERR_NETWORK_ERROR);
  }

  if (!res.ok) {
    let errorCode: ErrorCode | undefined;
    try {
      const data = await res.json();
      if (data && typeof data === 'object' && typeof data.code === 'string') {
        if (Object.values(ErrorCode).includes(data.code as ErrorCode)) {
          errorCode = data.code as ErrorCode;
        }
      }
    } catch {
      // Ignore JSON parse errors on non-OK responses
    }

    throw createSafeError(errorCode || res.status);
  }

  try {
    const data = await res.json();
    return data as T;
  } catch {
    throw createSafeError(
      ErrorCode.ERR_INVALID_FORMAT,
      'Malformed JSON response received from two-factor service',
    );
  }
}

// ─── Service Class & Instance ──────────────────────────────────────────────────

export class TwoFactorService {
  public _lockoutStore: TwoFactorLockoutStore | null = null;

  /**
   * Sets a pluggable lockout store (e.g. Redis-backed store on backend).
   */
  public setLockoutStore(store: TwoFactorLockoutStore | null): void {
    this._lockoutStore = store;
  }

  /**
   * Initiates 2FA setup.
   * Calls POST /api/auth/2fa/setup and returns the secret, QR code URL, and optional recovery codes.
   * Validates response shape and maps errors to ErrorCode constants.
   */
  public async beginSetup(): Promise<TwoFactorSetupResult> {
    const data = await request2Fa<TwoFactorSetupResult>('/api/auth/2fa/setup', {
      method: 'POST',
    });

    if (!data || typeof data !== 'object' || typeof data.secret !== 'string' || !data.secret) {
      throw createSafeError(
        ErrorCode.ERR_INVALID_FORMAT,
        'Invalid response from server: missing secret key',
      );
    }

    return {
      secret: data.secret,
      qrCodeDataUrl: typeof data.qrCodeDataUrl === 'string' ? data.qrCodeDataUrl : undefined,
      uri: typeof data.uri === 'string' ? data.uri : undefined,
      recoveryCodes: Array.isArray(data.recoveryCodes) ? data.recoveryCodes : undefined,
    };
  }

  /**
   * Confirms and completes 2FA setup using a 6-digit TOTP code.
   * Normalizes the code before sending and validates response shape.
   */
  public async confirmSetup(code: string): Promise<TwoFactorConfirmResult> {
    const normalizedCode = normalizeTotpCode(code);
    const data = await request2Fa<TwoFactorConfirmResult>('/api/auth/2fa/verify-setup', {
      method: 'POST',
      body: { code: normalizedCode },
    });

    if (!data || typeof data !== 'object') {
      throw createSafeError(
        ErrorCode.ERR_INVALID_FORMAT,
        'Invalid response from server: expected object',
      );
    }

    if (data.recoveryCodes !== undefined && !Array.isArray(data.recoveryCodes)) {
      throw createSafeError(
        ErrorCode.ERR_INVALID_FORMAT,
        'Invalid response from server: recoveryCodes must be an array',
      );
    }

    return {
      recoveryCodes: Array.isArray(data.recoveryCodes) ? data.recoveryCodes : [],
      success: typeof data.success === 'boolean' ? data.success : true,
    };
  }

  /**
   * Verifies a 6-digit TOTP code for a login challenge.
   * Normalizes the code before sending and validates response shape.
   */
  public async verify(code: string, challengeToken?: string): Promise<TwoFactorVerifyResult> {
    const normalizedCode = normalizeTotpCode(code);
    const body: Record<string, unknown> = {
      code: normalizedCode,
      mode: 'totp',
    };
    if (challengeToken) {
      body.challengeToken = challengeToken;
    }

    const data = await request2Fa<TwoFactorVerifyResult>('/api/auth/2fa/verify', {
      method: 'POST',
      body,
    });

    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.accessToken !== 'string' ||
      typeof data.refreshToken !== 'string'
    ) {
      throw createSafeError(
        ErrorCode.ERR_INVALID_FORMAT,
        'Invalid response from server: missing authentication tokens',
      );
    }

    return data;
  }

  /**
   * Verifies a backup recovery code for a login challenge.
   * Normalizes the recovery code (stripping whitespace/hyphens and uppercasing) before sending.
   */
  public async verifyRecoveryCode(
    code: string,
    challengeToken?: string,
  ): Promise<TwoFactorVerifyResult> {
    const normalizedCode = normalizeRecoveryCode(code);
    const body: Record<string, unknown> = {
      code: normalizedCode,
      mode: 'recovery',
    };
    if (challengeToken) {
      body.challengeToken = challengeToken;
    }

    const data = await request2Fa<TwoFactorVerifyResult>('/api/auth/2fa/verify', {
      method: 'POST',
      body,
    });

    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.accessToken !== 'string' ||
      typeof data.refreshToken !== 'string'
    ) {
      throw createSafeError(
        ErrorCode.ERR_INVALID_FORMAT,
        'Invalid response from server: missing authentication tokens',
      );
    }

    return data;
  }

  /**
   * Disables 2FA on the user's account using their password for confirmation.
   * Validates password presence and maps errors to ErrorCode constants.
   */
  public async disable(password: string): Promise<TwoFactorDisableResult> {
    if (typeof password !== 'string' || !password.trim()) {
      throw createSafeError(
        ErrorCode.ERR_MISSING_PARAMETERS,
        'Password is required to disable two-factor authentication',
      );
    }

    const data = await request2Fa<TwoFactorDisableResult>('/api/auth/2fa/disable', {
      method: 'POST',
      body: { password },
    });

    return {
      success: typeof data?.success === 'boolean' ? data.success : true,
      message: typeof data?.message === 'string' ? data.message : undefined,
    };
  }

  /**
   * Regenerates backup recovery codes from the server.
   * Validates response shape and returns the new recovery codes.
   */
  public async regenerateRecoveryCodes(): Promise<TwoFactorRegenerateResult> {
    const data = await request2Fa<TwoFactorRegenerateResult>(
      '/api/auth/2fa/recovery-codes/regenerate',
      {
        method: 'POST',
      },
    );

    if (!data || typeof data !== 'object' || !Array.isArray(data.recoveryCodes)) {
      throw createSafeError(
        ErrorCode.ERR_INVALID_FORMAT,
        'Invalid response from server: recoveryCodes must be an array',
      );
    }

    return {
      recoveryCodes: data.recoveryCodes,
    };
  }

  // ─── Lockout Delegation (pluggable store support) ───────────────────────────

  public async recordFailedAttempt(userId?: string): Promise<void> {
    if (this._lockoutStore && userId) {
      await this._lockoutStore.recordFailedAttempt(userId);
    }
  }

  public async isLockedOut(userId?: string): Promise<boolean> {
    if (this._lockoutStore && userId) {
      return await this._lockoutStore.isLockedOut(userId);
    }
    return false;
  }

  public async getLockoutRemainingMs(userId?: string): Promise<number> {
    if (this._lockoutStore && userId) {
      return await this._lockoutStore.getLockoutRemainingMs(userId);
    }
    return 0;
  }

  public async resetFailedAttempts(userId?: string): Promise<void> {
    if (this._lockoutStore && userId) {
      await this._lockoutStore.resetFailedAttempts(userId);
    }
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const twoFactorService = new TwoFactorService();

// Standalone function exports matching the thin typed wrapper contract
export const beginSetup = (): Promise<TwoFactorSetupResult> => twoFactorService.beginSetup();
export const confirmSetup = (code: string): Promise<TwoFactorConfirmResult> =>
  twoFactorService.confirmSetup(code);
export const verify = (code: string, challengeToken?: string): Promise<TwoFactorVerifyResult> =>
  twoFactorService.verify(code, challengeToken);
export const verifyRecoveryCode = (
  code: string,
  challengeToken?: string,
): Promise<TwoFactorVerifyResult> => twoFactorService.verifyRecoveryCode(code, challengeToken);
export const disable = (password: string): Promise<TwoFactorDisableResult> =>
  twoFactorService.disable(password);
export const regenerateRecoveryCodes = (): Promise<TwoFactorRegenerateResult> =>
  twoFactorService.regenerateRecoveryCodes();

export default twoFactorService;
