import { errorCodeFromResponse, appErrorFromResponse } from './errorCodeFromResponse';
import { ErrorCode } from '../constants/ErrorCodes';

describe('errorCodeFromResponse', () => {
  it('maps an invalid-credentials login response', () => {
    const body = { error: 'Invalid credentials', message: 'Invalid credentials' };
    expect(errorCodeFromResponse(401, body)).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
    const err = appErrorFromResponse(401, body);
    expect(err.code).toBe(ErrorCode.ERR_INVALID_CREDENTIALS);
    expect(err.message).toBe('Invalid credentials');
  });

  it('maps common statuses and falls back to internal error', () => {
    expect(errorCodeFromResponse(401, { message: 'Unauthorized' })).toBe(ErrorCode.ERR_AUTH_REQUIRED);
    expect(errorCodeFromResponse(404)).toBe(ErrorCode.ERR_NOT_FOUND);
    expect(errorCodeFromResponse(500)).toBe(ErrorCode.ERR_INTERNAL_SERVER_ERROR);
  });
});
