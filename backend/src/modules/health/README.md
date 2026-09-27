# Health Module

## Scope

This module owns the health-check and readiness surface for the backend: liveness/readiness probes, dependency checks (database, cache, external providers), and the aggregated status payload consumed by orchestrators and uptime monitors.

## Migration status

**Work-in-progress migration target — not yet the live/mounted implementation.**

The live request path is still served by the legacy flat tree. `registerModules()` in `src/modules/index.ts` is not yet wired into `src/app.ts`; the app currently mounts `src/routes/v1/index.ts` for both `/api/v1` and the legacy `/api` prefix. See `backend/docs/module-architecture.md` for the full migration plan and the canonical-vs-deprecated layout reference.

## Legacy equivalent

The flat implementation this module is migrating toward lives in:

- `src/routes/` — health route definitions
- `src/controllers/` — health request handlers
- `src/services/` — health/dependency-check services

Those directories are deprecated: do not add new files there. New health work belongs in this module. When touching a deprecated health file, move it here as part of the same change and reconcile any divergence rather than overwriting.

## Public API surface

- `index.ts` — module entry point exporting the health routes/services for registration via `registerModules()`.
- `routes.ts` — route definitions for the health endpoints.
- `services/` — dependency-check and status-aggregation services.

## Contributing

- Add new health code here, not in the flat tree.
- Import shared infrastructure from `src/shared/` (e.g. `src/shared/lib/logger.ts`).
- Tests go in `src/__tests__/`.
