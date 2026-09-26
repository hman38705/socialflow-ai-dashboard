// Hand-maintained API types. This file is NOT generated. Types that are part of
// the OpenAPI spec are generated under src/api/models/*.ts; only types that are
// not (or that narrow the generated ones) live here.

export type WebhookEventType =
  | 'post.published'
  | 'post.failed'
  | 'analytics.report_ready'
  | 'blockchain.transaction_completed'
  | 'blockchain.transaction_failed'
  | 'system.health_check';

export type WebhookSubscription = {
  id?: string;
  url?: string;
  events?: WebhookEventType[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateWebhookRequest = {
  url: string;
  secret: string;
  events: WebhookEventType[];
};

export type UpdateWebhookRequest = {
  url?: string;
  secret?: string;
  events?: WebhookEventType[];
  isActive?: boolean;
};

export type WebhookDelivery = {
  id?: string;
  eventType?: WebhookEventType;
  status?: 'pending' | 'success' | 'failed';
  attempts?: number;
  responseStatus?: number | null;
  errorMessage?: string | null;
  createdAt?: string;
  nextRetryAt?: string | null;
};

export type TranslationRequest = {
  text: string;
  sourceLanguage?: string;
  targetLanguages: string[];
  preserveFormatting?: boolean;
  preserveHashtags?: boolean;
  preserveMentions?: boolean;
  preserveUrls?: boolean;
  preserveEmojis?: boolean;
};

export type TranslationResult = {
  sourceLanguage?: string;
  translations?: Record<string, string>;
};

export type Language = {
  code?: string;
  name?: string;
};

export type CircuitBreakerStats = {
  state?: 'closed' | 'open' | 'half-open';
  failures?: number;
  successes?: number;
  lastFailureTime?: string | null;
};

export type HealthStatus = {
  status?: 'healthy' | 'degraded' | 'unhealthy';
  timestamp?: string;
};

export type SystemStatus = {
  overallStatus?: 'healthy' | 'degraded' | 'unhealthy';
  services?: Record<string, HealthStatus>;
};

export type AnalyzeImageRequest = {
  /** Base64-encoded image data or public image URL */
  imageData: string;
  mimeType?: string;
  context?: string;
};

export type AnalyticsFilters = {
  platform?: 'twitter' | 'linkedin' | 'instagram' | 'tiktok' | null;
  from?: number | null;
  to?: number | null;
};

export type ConfigUpdateRequest = {
  value: unknown;
  type?: string;
  description?: string;
};

export type ErrorResponse = {
  message?: string;
  error?: string;
  code?: string;
};
