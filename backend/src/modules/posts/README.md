# Posts Module

## Scope

The `posts` module owns the domain logic for creating, scheduling, publishing, and
managing posts across connected social platforms. It is the canonical home for
post-related routes, services, and controllers as the backend migrates away from
the legacy flat layout.

## Migration status

**Work-in-progress migration target — not yet the live/mounted implementation.**

The live request path is still served by the legacy flat tree:

- `backend/src/routes/` — post routes (mounted via `backend/src/routes/v1/index.ts`)
- `backend/src/controllers/` — post controllers
- `backend/src/services/` — post services

This module is registered through `registerModules()` in `backend/src/modules/index.ts`,
which is **not yet wired into `backend/src/app.ts`**. Until that wiring lands, treat the
legacy flat files above as authoritative for runtime behavior and this module as the
target for new work.

See `backend/docs/module-architecture.md` for the full migration plan, the list of
deprecated directories, and the known diverged files that must be reconciled when
migrating.

## Public API surface

- `index.ts` — module entry point exporting the module's routes/services for
  registration via `registerModules()`.

## Contributing

- Add new post-related code here, not in `backend/src/{routes,controllers,services}`.
- When migrating a file from the legacy tree, reconcile any divergence rather than
  overwriting (see the diverged-files table in `backend/docs/module-architecture.md`).
