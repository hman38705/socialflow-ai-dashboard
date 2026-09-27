/**
 * Auth module — public entry point.
 *
 * Scope:
 *   Authentication and authorization for the API: login/logout, token
 *   issuance and refresh, session/credential handling, and the middleware
 *   used to guard protected routes.
 *
 * Migration status:
 *   Work-in-progress migration target. This `modules/auth` tree is the
 *   intended home for the auth domain, but the live/mounted implementation
 *   is still the legacy flat tree under `backend/src/routes`,
 *   `backend/src/controllers`, and `backend/src/services`. Treat the legacy
 *   tree as authoritative until the corresponding routes/controllers/services
 *   are ported here and this module is wired into the app's router.
 *
 * Legacy equivalent:
 *   - backend/src/routes (auth route definitions)
 *   - backend/src/controllers (auth request handlers)
 *   - backend/src/services (auth business logic)
 *
 * Stubs:
 *   Anything exported here that is not yet mounted in the app router should
 *   be considered a stub/placeholder for the migration, not live behavior.
 */
export { default as authRoutes } from './routes';
