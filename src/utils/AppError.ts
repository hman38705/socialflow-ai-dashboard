import { ErrorCode, ErrorStatusMap } from '../constants/ErrorCodes';

/**
 * Custom Error Class for the Application
 * Allows passing an ErrorCode from the centralized enum.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message?: string) {
    // If no message is provided, use the status map or the code itself
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ErrorStatusMap[code] || 500;
    
    // Ensure the stack trace is correct
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Serializes this client-side error for local use (logging, UI state).
   * This is NOT the backend's wire format, which has no `code` field.
   */
  public toResponse() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode
      }
    };
  }

  /**
   * Type guard to check if an error is an AppError
   */
  public static isAppError(error: any): error is AppError {
    return error instanceof AppError;
  }
}
