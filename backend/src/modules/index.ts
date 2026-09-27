import { authRoutes } from './auth';
import { organizationRoutes } from './organization';
import { webhookRoutes } from './webhook';
import { analyticsRoutes } from './analytics';
import socialYoutubeRoutes from './social/routes.youtube';
import socialFacebookRoutes from './social/routes.facebook';
import videoRoutes from './content/routes.video';
import translationRoutes from './content/routes.translation';
import ttsRoutes from './content/routes.tts';
import billingRoutes from './billing/routes';
import { postsRouter } from './posts';

/**
 * Module Registry
 * Centralized registration of all domain modules
 */

export function registerModules(app: any): void {
  // Auth module
  app.use('/api/auth', authRoutes);

  // Organization module
  app.use('/api/organizations', organizationRoutes);

  // Webhook module
  app.use('/api/webhooks', webhookRoutes);

  // Analytics module
  app.use('/api/analytics', analyticsRoutes);

  // Social module routes (YouTube, Facebook)
  app.use('/api/youtube', socialYoutubeRoutes);
  app.use('/api/facebook', socialFacebookRoutes);

  // Content module routes
  app.use('/api/video', videoRoutes);
  app.use('/api/translation', translationRoutes);
  app.use('/api/tts', ttsRoutes);

  // Billing module
  app.use('/api/billing', billingRoutes);

  // Posts module (create → moderation → schedule)
  app.use('/api/posts', postsRouter);
}

export * from './health';
export * from './social';
export * from './content';
export * from './billing';
export * from './auth';
export * from './organization';
export * from './webhook';
export * from './analytics';
