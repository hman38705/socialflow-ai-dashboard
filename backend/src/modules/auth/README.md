# Auth Module

## Scope

This module owns authentication and authorization concerns for the API:

- User registration and login
- Credential verification and password hashing
- Session / token issuance and validation
- Route-level auth guards and middleware

## Migration status

**Work-in-progress migration target.** This module is the intended home for
auth logic going forward, but it is not yet the authoritative implementation.
The live, mounted implementation currently lives in the legacy flat tree:

- `backend/src/routes` — auth route definitions
- `backend/src/controllers` — auth request handlers
- `backend/src/services` — auth business logic (credential checks, token handling)

Until the migration is complete, treat the legacy flat files above as the
source of truth for runtime behavior. Anything under this module should be
considered a staging area and may not be wired into the app yet.

## Public API surface

See `index.ts` in this directory for the module's exported entry points. As the
migration progresses, exports here are expected to replace the corresponding
legacy route/controller/service wiring.

## Stubs / known gaps

- Parts of this module may be intentionally stubbed while the legacy
  implementation is still live. Do not assume an export here is mounted or
  reachable from the HTTP layer without checking the app's route registration.

## Migration plan

1. Port behavior from `backend/src/{routes,controllers,services}` into this
   module, keeping parity with the legacy implementation.
2. Mount the module's routes in the app and remove the legacy wiring.
3. Delete the legacy flat auth files once nothing references them.
