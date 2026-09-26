import { AppError } from './AppError';
import { ErrorCode } from '../constants/ErrorCodes';

/** Shape the backend actually sends (see src/api/models/Error.ts). */
export interface BackendErrorBody {
  error?: string;
  message?: string;
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.ERR_BAD_REQUEST,
  401: ErrorCode.ERR_AUTH_REQUIRED,
  402: ErrorCode.ERR_PAYMENT_REQUIRED,
  403: ErrorCode.ERR_FORBIDDEN,
  404: ErrorCode.ERR_NOT_FOUND,
  409: ErrorCode.ERR_RESOURCE_EXISTS,
  422: ErrorCode.ERR_VALIDATION_FAILED,
  501: ErrorCode.ERR_NOT_IMPLEMENTED,
  503: ErrorCode.ERR_NETWORK_ERROR,
};

/**
 * Maps a real backend error response (HTTP status + `{ error, message }` body)
 * to a client-side ErrorCode.
 */
export function errorCodeFromResponse(status: number, body?: BackendErrorBody | null): ErrorCode {
  if (status === 401 && /invalid|credential/i.test(`${body?.error ?? ''} ${body?.message ?? ''}`)) {
    return ErrorCode.ERR_INVALID_CREDENTIALS;
  }
  return STATUS_TO_CODE[status] ?? ErrorCode.ERR_INTERNAL_SERVER_ERROR;
}

/** Builds an AppError from a real backend error response. */
export function appErrorFromResponse(status: number, body?: BackendErrorBody | null): AppError {
  return new AppError(errorCodeFromResponse(status, body), body?.message ?? body?.error);
}
