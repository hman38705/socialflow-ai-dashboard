/**
 * Posts module.
 *
 * Scope: domain logic for user-authored posts (create/read/update/delete)
 * and the post data shapes consumed by the rest of the application.
 *
 * Migration status: work-in-progress migration target. This codebase is
 * mid-migration from the legacy flat layout to the `modules/**` tree, and
 * both implementations currently coexist for most domains. Do not assume
 * this module is the live/mounted implementation yet — verify against the
 * app's route registration before relying on it.
 *
 * Legacy equivalent: `backend/src/routes`, `backend/src/controllers`, and
 * `backend/src/services` still contain the flat implementation of this
 * domain. Keep the two in sync until the migration for this domain is done.
 *
 * See `README.md` in this directory for more detail.
 */

export {};
