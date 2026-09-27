/**
 * Webhook module.
 *
 * Scope: outbound webhook delivery for domain events — dispatching signed
 * HTTP callbacks to subscriber endpoints and tracking delivery attempts.
 *
 * Migration status: work-in-progress migration target. This module is the
 * intended home for the webhook domain as the codebase moves off the legacy
 * flat tree; it is not yet the sole authoritative implementation. The legacy
 * equivalent lives in `backend/src/routes`, `backend/src/controllers`, and
 * `backend/src/services` (see the webhook-related files there). Until the
 * migration completes, treat the legacy implementation as the source of truth
 * for behavior that has not yet been ported here.
 *
 * Public API surface: `WebhookDispatcher` (delivery service) and the default
 * `webhookRoutes` router.
 */
export { WebhookDispatcher } from './services/WebhookDispatcher';
export { default as webhookRoutes } from './routes';
