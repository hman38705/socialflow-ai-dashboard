import { logger } from '../lib/logger';

type TwilioClientType = ReturnType<typeof import('twilio')>;

export interface SmsServiceConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SmsService {
  private twilioClient: TwilioClientType | null = null;
  private fromNumber: string | undefined;
  private enabled: boolean;

  constructor(config: SmsServiceConfig) {
    this.enabled = !!(config.accountSid && config.authToken && config.fromNumber);
    this.fromNumber = config.fromNumber;

    if (this.enabled) {
      try {
        // Lazy load Twilio SDK only if credentials are provided
        const twilio = require('twilio') as typeof import('twilio');
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
      return {
        success: false,
        error: 'SMS service not configured',
      };
    }

    try {
      const result = await this.twilioClient!.messages.create({
        body: message,
        from: this.fromNumber,
        to,
      });

      logger.info(`[sms-service] SMS sent successfully to ${to}, messageId: ${result.sid}`);
      return {
        success: true,
        messageId: result.sid,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[sms-service] Failed to send SMS to ${to}: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let smsServiceInstance: SmsService | null = null;

export function createSmsService(config: SmsServiceConfig): SmsService {
  smsServiceInstance = new SmsService(config);
  return smsServiceInstance;
}

export function getSmsService(): SmsService {
  if (!smsServiceInstance) {
    // Create with empty config if not initialized
    smsServiceInstance = new SmsService({});
  }
  return smsServiceInstance;
}
