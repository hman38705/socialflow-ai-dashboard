/**
 * Organization module.
 *
 * Scope: organization-level domain logic (organization profile/settings and
 * related resources) exposed through this module's router.
 *
 * Migration status: work-in-progress migration target. This module is the
 * intended home for the organization domain as the codebase moves away from
 * the legacy flat tree. The legacy equivalent lives in
 * `backend/src/routes`, `backend/src/controllers`, and `backend/src/services`
 * (organization-related route/controller/service files); until the migration
 * is complete, treat the legacy flat implementation as authoritative for any
 * behavior not yet ported here.
 *
 * Public API surface: `organizationRoutes` (the module's Express router),
 * re-exported below for mounting by the application.
 *
 * Note: `routes.roles.ts` is intentionally NOT wired in here. Its relative
 * imports (`../middleware/*`, `../models/*`) do not resolve from this module
 * directory, so requiring it would throw `Cannot find module` at load time.
 * It stays dormant until those imports are corrected and it is explicitly
 * mounted.
 */
export { default as organizationRoutes } from './routes';
