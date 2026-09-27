/**
 * Health module.
 *
 * Scope: service health monitoring and alerting — periodic health checks
 * (`HealthMonitor`), aggregated health metrics (`HealthService`), alert
 * threshold configuration (`AlertConfigService`), and notification delivery
 * for triggered alerts (`NotificationManager` / `NotificationProvider`).
 *
 * Migration status: work-in-progress migration target. This module is the
 * intended home for the health domain, but the legacy flat implementation
 * under `backend/src/{routes,controllers,services}` remains the live/mounted
 * implementation. Treat the legacy tree as authoritative until this module is
 * wired into the app; the exports below are the module's public API surface.
 *
 * Legacy equivalent: `backend/src/routes`, `backend/src/controllers`, and
 * `backend/src/services` (health-related files).
 */
export { HealthService } from './services/healthService';
export { HealthMonitor } from './services/healthMonitor';
export {
  NotificationManager,
  NotificationProvider,
  AlertPayload,
} from './services/notificationProvider';
export { AlertConfigService } from './services/alertConfigService';
export type { HealthMetrics } from './services/healthMonitor';
export type { AlertThreshold, ServiceAlertConfig } from './services/alertConfigService';
