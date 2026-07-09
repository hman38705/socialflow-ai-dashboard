import { createLogger } from '../lib/logger';

const logger = createLogger('sms-service');

export interface SmsServiceConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  maxRetries?: number;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface TwilioError extends Error {
  code?: number;
  status?: number;
}

// Twilio error codes that must not be retried (#1076)
const NON_RETRYABLE_CODES = new Set([21211]); // 21211 = invalid phone number

function isNonRetryable(err: unknown): boolean {
  return typeof (err as TwilioError).code === 'number' &&
    NON_RETRYABLE_CODES.has((err as TwilioError).code!);
}

function isTransient(err: unknown): boolean {
  const status = (err as TwilioError).status;
  return typeof status === 'number' && status >= 500;
}

export class SmsService {
  private twilioClient: any;
  private fromNumber: string | undefined;
  private enabled: boolean;
  private maxRetries: number;

  constructor(config: SmsServiceConfig) {
    this.enabled = !!(config.accountSid && config.authToken && config.fromNumber);
    this.fromNumber = config.fromNumber;
    this.maxRetries = config.maxRetries ?? 3;

    if (this.enabled) {
      try {
        const twilio = require('twilio');
        this.twilioClient = twilio(config.accountSid, config.authToken);
        logger.info('[sms-service] Twilio SMS service initialized');
      } catch (error) {
        logger.warn(
          '[sms-service] Twilio SDK not available, SMS notifications will be disabled',
        );
        this.enabled = false;
      }
    } else {
      logger.info('[sms-service] SMS service disabled (missing credentials)');
    }
  }

  async send(to: string, message: string): Promise<SmsResult> {
    if (!this.enabled) {
      logger.warn('[sms-service] SMS send attempted but service is disabled');
      return { success: false, error: 'SMS service not configured' };
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.twilioClient.messages.create({
          body: message,
          from: this.fromNumber,
          to,
        });
        logger.info(`[sms-service] SMS sent successfully to ${to}, messageId: ${result.sid}`);
        return { success: true, messageId: result.sid };
      } catch (error) {
        if (isNonRetryable(error)) {
          // Permanent error — rethrow immediately without retry (#1076)
          throw error;
        }
        lastError = error;
        if (!isTransient(error) || attempt === this.maxRetries) {
          break;
        }
        logger.warn(`[sms-service] Transient error on attempt ${attempt}, retrying...`);
      }
    }

    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    logger.error(`[sms-service] Failed to send SMS to ${to}: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

let smsServiceInstance: SmsService | null = null;

export function createSmsService(config: SmsServiceConfig): SmsService {
  smsServiceInstance = new SmsService(config);
  return smsServiceInstance;
}

/**
 * Factory that reads credentials from TWILIO_* env vars and throws at startup
 * if any are absent — preventing a silent runtime failure on first send (#1086).
 */
export function createSmsServiceFromEnv(): SmsService {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      'Missing required Twilio environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
    );
  }

  return createSmsService({ accountSid, authToken, fromNumber });
}

export function getSmsService(): SmsService {
  if (!smsServiceInstance) {
    smsServiceInstance = new SmsService({});
  }
  return smsServiceInstance;
}
