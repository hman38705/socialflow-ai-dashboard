/**
 * Circuit Breaker Configuration
 *
 * Defines circuit breaker settings for different external services
 * to prevent cascading failures and improve system resilience.
 * Supports: ai, translation, twitter, blockchain, ipfs, price, youtube, facebook, instagram
 */

export interface CircuitBreakerConfig {
  timeout: number; // Request timeout in ms
  errorThresholdPercentage: number; // % of failures to open circuit
  resetTimeout: number; // Time in ms before attempting to close circuit
  rollingCountTimeout: number; // Time window for error calculation
  rollingCountBuckets: number; // Number of buckets in rolling window
  volumeThreshold: number; // Minimum requests before circuit can open
  name: string; // Circuit breaker name for monitoring
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  timeout: 10000, // 10 seconds
  errorThresholdPercentage: 50, // Open after 50% failures
  resetTimeout: 30000, // Try again after 30 seconds
  rollingCountTimeout: 10000, // 10 second window
  rollingCountBuckets: 10, // 10 buckets
  volumeThreshold: 5, // Need 5 requests minimum
  name: 'default',
};

/**
 * Service-specific circuit breaker configurations
 */
export const CIRCUIT_CONFIGS = {
  // OpenAI/Gemini AI - More lenient due to importance
  ai: {
    timeout: 30000, // 30 seconds (AI can be slow)
    errorThresholdPercentage: 60, // More tolerant
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 30000, // 30 second window
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'ai-service',
  } as CircuitBreakerConfig,

  // Translation APIs - Moderate settings
  translation: {
    timeout: 15000, // 15 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 45000, // 45 seconds
    rollingCountTimeout: 20000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
    name: 'translation-service',
  } as CircuitBreakerConfig,

  // Twitter/Social APIs - Strict settings
  twitter: {
    timeout: 10000, // 10 seconds
    errorThresholdPercentage: 40, // Less tolerant
    resetTimeout: 30000, // 30 seconds
    rollingCountTimeout: 15000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
    name: 'twitter-service',
  } as CircuitBreakerConfig,

  // Blockchain RPC - Very strict
  blockchain: {
    timeout: 8000, // 8 seconds
    errorThresholdPercentage: 30, // Very strict
    resetTimeout: 20000, // 20 seconds
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'blockchain-service',
  } as CircuitBreakerConfig,

  // IPFS - Moderate to lenient
  ipfs: {
    timeout: 20000, // 20 seconds (uploads can be slow)
    errorThresholdPercentage: 50,
    resetTimeout: 40000, // 40 seconds
    rollingCountTimeout: 20000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
    name: 'ipfs-service',
  } as CircuitBreakerConfig,

  // Price APIs - Lenient (not critical)
  price: {
    timeout: 12000, // 12 seconds
    errorThresholdPercentage: 60,
    resetTimeout: 60000, // 1 minute
    rollingCountTimeout: 30000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
    name: 'price-service',
  } as CircuitBreakerConfig,

  // YouTube Data API v3
  youtube: {
    timeout: 15000, // 15 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 20000,
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'youtube-service',
  } as CircuitBreakerConfig,

  // Facebook Graph API
  facebook: {
    timeout: 15000, // 15 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 20000,
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'facebook-service',
  } as CircuitBreakerConfig,

  // Instagram Graph API
  instagram: {
    timeout: 20000, // 20 seconds (video uploads can be slow)
    errorThresholdPercentage: 50,
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 20000,
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'instagram-service',
  } as CircuitBreakerConfig,

  // TikTok Content Posting API — lenient for chunked video uploads
  tiktok: {
    timeout: 60000, // 60 seconds (chunked video uploads can be slow)
    errorThresholdPercentage: 50,
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 30000,
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'tiktok-service',
  } as CircuitBreakerConfig,

  // LinkedIn Marketing Developer Platform
  linkedin: {
    timeout: 15000, // 15 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 20000,
    rollingCountBuckets: 10,
    volumeThreshold: 3,
    name: 'linkedin-service',
  } as CircuitBreakerConfig,

  // Notification providers (Slack, Discord, email etc.) — Circuit opens after repeated failures
  // to prevent filling the retry queue when providers are unreachable.
  notification: {
    timeout: 15000, // 15 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 60000, // 1 minute cooldown
    rollingCountTimeout: 30000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
    name: 'notification-service',
  } as CircuitBreakerConfig,
};

/**
 * Fallback strategies for different service types
 */
export const FALLBACK_STRATEGIES = {
  ai: {
    enabled: true,
    message: 'AI service temporarily unavailable. Using cached or default response.',
  },
  translation: {
    enabled: true,
    message: 'Translation service unavailable. Returning original text.',
  },
  twitter: {
    enabled: false,
    message: 'Social media API unavailable. Please try again later.',
  },
  tiktok: {
    enabled: false,
    message: 'TikTok API unavailable. Please try again later.',
  },
  linkedin: {
    enabled: false,
    message: 'LinkedIn API unavailable. Please try again later.',
  },
  instagram: {
    enabled: false,
    message: 'Instagram API unavailable. Please try again later.',
  },
  blockchain: {
    enabled: false,
    message: 'Blockchain network unavailable. Transaction cannot be processed.',
  },
  ipfs: {
    enabled: true,
    message: 'IPFS service unavailable. Using local storage fallback.',
  },
  price: {
    enabled: true,
    message: 'Price service unavailable. Using cached prices.',
  },
  youtube: {
    enabled: false,
    message: 'YouTube API unavailable. Please try again later.',
  },
  facebook: {
    enabled: false,
    message: 'Facebook API unavailable. Please try again later.',
  },

  // Notification — Soft fallback so queue processing doesn't throw unhandled rejections
  notification: {
    enabled: true,
    message: 'Notification service temporarily unavailable. Skipping notification.',
  },
};
