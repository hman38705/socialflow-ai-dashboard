import crypto from 'crypto';
import { WebhookConfig, WebhookEvent, WebhookSignatureResult } from '../types';

/**
 * Webhook Service - Implements zero-downtime secret rotation
 * 
 * This service supports dual signatures during the rotation period,
 * allowing users to rotate their webhook signing secrets without
 * service interruption.
 */

// In-memory storage for webhook configurations (in production, use a database)
const webhookConfigs: Map<string, WebhookConfig> = new Map();

/**
 * Generate a HMAC-SHA256 signature for webhook payload
 */
export const generateSignature = (payload: string, secret: string): string => {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
};

/**
 * Verify webhook signature using current or old secret
 * Supports dual signature validation during rotation period
 */
export const verifyWebhookSignature = (
  payload: string,
  signature: string,
  config: WebhookConfig
): WebhookSignatureResult => {
  try {
    if (!signature) {
      return { valid: false, secretUsed: null, error: 'Missing signature' };
    }

    // Try current secret first
    const currentSignature = generateSignature(payload, config.secret);
    if (timingSafeEqual(signature, currentSignature)) {
      return { valid: true, secretUsed: 'current' };
    }

    // Try old secret if rotation is in progress
    if (config.rotationInProgress && config.oldSecret) {
      const oldSignature = generateSignature(payload, config.oldSecret);
      if (timingSafeEqual(signature, oldSignature)) {
        return { valid: true, secretUsed: 'old' };
      }
    }

    return { valid: false, secretUsed: null, error: 'Invalid signature' };
  } catch (error) {
    return { 
      valid: false, 
      secretUsed: null, 
      error: error instanceof Error ? error.message : 'Verification failed' 
    };
  }
};

/**
 * Timing-safe string comparison to prevent timing attacks
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Create a new webhook configuration
 */
export const createWebhookConfig = (
  url: string,
  secret: string
): WebhookConfig => {
  const config: WebhookConfig = {
    id: crypto.randomUUID(),
    url,
    secret,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    rotationInProgress: false,
  };
  
  webhookConfigs.set(config.id, config);
  return config;
};

/**
 * Get webhook configuration by ID
 */
export const getWebhookConfig = (id: string): WebhookConfig | undefined => {
  return webhookConfigs.get(id);
};

/**
 * Get all webhook configurations
 */
export const getAllWebhookConfigs = (): WebhookConfig[] => {
  return Array.from(webhookConfigs.values());
};

/**
 * Start secret rotation process
 * This sets up the old secret for dual validation while new secret is used
 */
export const startSecretRotation = (id: string, newSecret: string): WebhookConfig | null => {
  const config = webhookConfigs.get(id);
  
  if (!config) {
    return null;
  }

  // Store current secret as oldSecret for dual validation
  config.oldSecret = config.secret;
  config.secret = newSecret;
  config.rotationInProgress = true;
  config.rotationStartedAt = new Date();
  config.updatedAt = new Date();
  
  webhookConfigs.set(id, config);
  return config;
};

/**
 * Complete secret rotation
 * This removes the old secret after rotation is confirmed
 */
export const completeSecretRotation = (id: string): WebhookConfig | null => {
  const config = webhookConfigs.get(id);
  
  if (!config) {
    return null;
  }

  // Clear old secret after successful rotation
  config.oldSecret = undefined;
  config.rotationInProgress = false;
  config.rotationStartedAt = undefined;
  config.updatedAt = new Date();
  
  webhookConfigs.set(id, config);
  return config;
};

/**
 * Cancel secret rotation
 * This reverts to using the old secret
 */
export const cancelSecretRotation = (id: string): WebhookConfig | null => {
  const config = webhookConfigs.get(id);
  
  if (!config || !config.oldSecret) {
    return null;
  }

  // Revert to old secret
  config.secret = config.oldSecret;
  config.oldSecret = undefined;
  config.rotationInProgress = false;
  config.rotationStartedAt = undefined;
  config.updatedAt = new Date();
  
  webhookConfigs.set(id, config);
  return config;
};

/**
 * Delete webhook configuration
 */
export const deleteWebhookConfig = (id: string): boolean => {
  return webhookConfigs.delete(id);
};

/**
 * Process incoming webhook event with dual signature support
 */
export const processWebhookEvent = (
  payload: string,
  signature: string,
  configId: string
): WebhookEvent | null => {
  const config = webhookConfigs.get(configId);
  
  if (!config || !config.isActive) {
    return null;
  }

  const result = verifyWebhookSignature(payload, signature, config);
  
  const event: WebhookEvent = {
    id: crypto.randomUUID(),
    type: 'webhook.event',
    timestamp: new Date(),
    payload: JSON.parse(payload),
    signature,
    verified: result.valid,
  };

  return event;
};

/**
 * Generate a new secret for rotation
 */
export const generateNewSecret = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Validate secret format
 */
export const isValidSecret = (secret: string): boolean => {
  // Secret should be at least 32 characters (256 bits in hex)
  return /^[a-f0-9]{32,}$/i.test(secret);
};
