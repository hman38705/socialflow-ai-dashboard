// refs: #1076 (type safety), #1086 (sync require)
import { SmsService, createSmsServiceFromEnv } from '../services/smsService';

const mockMessagesCreate = jest.fn();

jest.mock('twilio', () =>
  jest.fn(() => ({ messages: { create: mockMessagesCreate } })),
);

const VALID_CONFIG = {
  accountSid: 'ACtest123',
  authToken: 'token123',
  fromNumber: '+15551234567',
};

describe('SmsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  describe('send() — happy path', () => {
    it('calls messages.create with correct from, to, and body', async () => {
      mockMessagesCreate.mockResolvedValue({ sid: 'SM123' });
      const service = new SmsService(VALID_CONFIG);

      await service.send('+15559876543', 'Hello world');

      expect(mockMessagesCreate).toHaveBeenCalledWith({
        from: '+15551234567',
        to: '+15559876543',
        body: 'Hello world',
      });
    });

    it('returns the Twilio message SID on success', async () => {
      mockMessagesCreate.mockResolvedValue({ sid: 'SM_SUCCESS_456' });
      const service = new SmsService(VALID_CONFIG);

      const result = await service.send('+15559876543', 'Test');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('SM_SUCCESS_456');
      expect(result.error).toBeUndefined();
    });
  });

  describe('send() — Twilio error code 21211 (invalid phone number)', () => {
    it('rethrows immediately without retrying', async () => {
      const nonRetryableError = Object.assign(new Error('Invalid phone number'), {
        code: 21211,
        status: 400,
      });
      mockMessagesCreate.mockRejectedValue(nonRetryableError);
      const service = new SmsService(VALID_CONFIG);

      await expect(service.send('not-a-number', 'Test')).rejects.toThrow('Invalid phone number');
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('send() — transient (500-class) errors', () => {
    it('retries on 500-class errors and succeeds on a later attempt', async () => {
      const transient = Object.assign(new Error('Service unavailable'), { status: 503 });
      mockMessagesCreate
        .mockRejectedValueOnce(transient)
        .mockRejectedValueOnce(transient)
        .mockResolvedValue({ sid: 'SM_RETRY_OK' });

      const service = new SmsService({ ...VALID_CONFIG, maxRetries: 3 });
      const result = await service.send('+15559876543', 'Test');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('SM_RETRY_OK');
      expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    });

    it('gives up after exhausting all configured retry attempts', async () => {
      const transient = Object.assign(new Error('Internal Server Error'), { status: 500 });
      mockMessagesCreate.mockRejectedValue(transient);

      const service = new SmsService({ ...VALID_CONFIG, maxRetries: 2 });
      const result = await service.send('+15559876543', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal Server Error');
      expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-transient, non-21211 errors', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Unknown Twilio error'));
      const service = new SmsService({ ...VALID_CONFIG, maxRetries: 3 });

      const result = await service.send('+15559876543', 'Test');

      expect(result.success).toBe(false);
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('send() — service disabled', () => {
    it('returns failure without calling Twilio when service is disabled', async () => {
      const service = new SmsService({});

      const result = await service.send('+15559876543', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMS service not configured');
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe('initialization', () => {
    it('is enabled when all three credentials are provided', () => {
      expect(new SmsService(VALID_CONFIG).isEnabled()).toBe(true);
    });

    it('is disabled when accountSid is missing', () => {
      expect(
        new SmsService({ authToken: 'token', fromNumber: '+15551234567' }).isEnabled(),
      ).toBe(false);
    });

    it('is disabled when authToken is missing', () => {
      expect(
        new SmsService({ accountSid: 'sid', fromNumber: '+15551234567' }).isEnabled(),
      ).toBe(false);
    });

    it('is disabled when fromNumber is missing', () => {
      expect(new SmsService({ accountSid: 'sid', authToken: 'token' }).isEnabled()).toBe(false);
    });

    it('degrades gracefully when the Twilio SDK throws during require()', () => {
      const twilio = require('twilio');
      twilio.mockImplementationOnce(() => {
        throw new Error('Module not found');
      });

      const service = new SmsService(VALID_CONFIG);
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('createSmsServiceFromEnv() — early startup validation', () => {
    it('throws when all TWILIO_* env vars are absent', () => {
      expect(() => createSmsServiceFromEnv()).toThrow(/TWILIO/);
    });

    it('throws when only TWILIO_ACCOUNT_SID is set', () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest';
      expect(() => createSmsServiceFromEnv()).toThrow(/TWILIO/);
    });

    it('throws when only two of three vars are set', () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      expect(() => createSmsServiceFromEnv()).toThrow(/TWILIO/);
    });

    it('creates an enabled service when all TWILIO_* env vars are present', () => {
      process.env.TWILIO_ACCOUNT_SID = 'ACtest';
      process.env.TWILIO_AUTH_TOKEN = 'authtoken';
      process.env.TWILIO_FROM_NUMBER = '+15551234567';

      mockMessagesCreate.mockResolvedValue({ sid: 'SM123' });
      const service = createSmsServiceFromEnv();
      expect(service.isEnabled()).toBe(true);
    });
  });
});
