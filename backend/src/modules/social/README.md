# Social Module

## Scope

The `social` module owns the social-graph and social-interaction domain of the
backend: following/unfollowing users, followers/following listings, and the
related social feed surfaces. It is the migration target for the social-domain
logic that currently lives in the legacy flat tree.

## Migration status

This module is a **work-in-progress migration target**, not (yet) the live
implementation. The authoritative, mounted implementation for the social
domain is still the legacy flat tree:

- `backend/src/routes/` — HTTP route definitions
- `backend/src/controllers/` — request handlers
- `backend/src/services/` — business logic and data access

Until the migration is complete, treat the legacy flat files as the source of
truth for behavior. Anything in this module should be considered a stub or an
in-progress port unless it is explicitly wired up and mounted.

## Public API surface

`index.ts` is the module entry point and re-exports the module's public
surface. As the migration progresses, consumers should import from this module
rather than reaching into the legacy flat files directly.

## Migration plan

1. Port the social-domain service logic from `backend/src/services/` into this
   module, keeping behavior identical.
2. Port the corresponding controllers and routes, and mount them from this
   module's `index.ts`.
3. Remove the legacy flat social files once the module is the live
   implementation and no callers depend on the old paths.

## Notes

- Parts of this module are intentionally still stubs; see the doc comment in
  `index.ts` for the current status.
- When adding new social-domain code, prefer adding it here and note the
  corresponding legacy file it is replacing.
