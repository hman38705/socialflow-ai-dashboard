export * from './types/translation';
export declare const SUPPORTED_EVENTS: readonly ["post.published", "post.failed", "analytics.report_ready", "blockchain.transaction_completed", "blockchain.transaction_failed", "system.health_check", "tiktok.video_processing", "tiktok.video_published", "tiktok.video_failed", "twitter.follow", "twitter.unfollow", "twitter.mention", "twitter.dm", "twitter.like", "twitter.tweet_delete"];
export type WebhookEventType = (typeof SUPPORTED_EVENTS)[number];
