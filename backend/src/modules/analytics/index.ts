/**
 * Analytics module.
 *
 * Scope: HTTP surface for analytics data (currently the analytics router
 * re-exported below). This module is the migration target for the analytics
 * domain; the legacy flat implementation lives under
 * `backend/src/routes`, `backend/src/controllers`, and `backend/src/services`
 * (e.g. the analytics route/controller/service files there).
 *
 * Migration status: work-in-progress. This module is not yet the authoritative
 * implementation for the domain — the legacy flat tree remains the live/mounted
 * implementation until the router here is wired up in `backend/src/app.ts` and
 * the legacy files are removed. Treat anything beyond the re-export below as a
 * stub.
 *
 * Public API: `analyticsRoutes` (the analytics router from `./routes`).
 */
export { default as analyticsRoutes } from './routes';
