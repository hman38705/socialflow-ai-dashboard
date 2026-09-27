# Analytics Module

## Scope

The `analytics` module owns the analytics domain: event ingestion, aggregation,
and the read APIs that surface analytics data to clients. It is the intended
home for all analytics routes, controllers, and services as the codebase
migrates away from the legacy flat tree.

## Migration status

**Work-in-progress migration target.** This module is *not* yet the live/mounted
implementation. The authoritative analytics implementation currently lives in
the legacy flat tree:

- `backend/src/routes/` — analytics route definitions
- `backend/src/controllers/` — analytics request handlers
- `backend/src/services/` — analytics business logic

Until the migration is complete, treat the legacy flat files as the source of
truth. Anything under this module directory is either a stub or an in-progress
port and should not be assumed to be wired into the running app.

## Public API surface

`index.ts` is the module entry point and re-exports the module's public surface
(routes, controllers, and services as they are migrated). Consumers should
import from `backend/src/modules/analytics` rather than reaching into
individual files.

## Migration plan

1. Port analytics services from `backend/src/services/` into this module.
2. Port analytics controllers from `backend/src/controllers/`.
3. Port analytics routes from `backend/src/routes/` and mount them from the
   module's `index.ts`.
4. Remove the corresponding legacy flat files once the module is mounted and
   verified.

## Notes for contributors

- Do not add new analytics logic to the legacy flat tree; add it here.
- If you are unsure which implementation is authoritative, check whether the
  route is mounted in `backend/src/app.ts`. If it is not mounted from this
  module, the legacy implementation is still live.
