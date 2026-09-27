# Organization Module

## Scope

The `organization` module owns everything related to organizations (tenants) and
their membership: creating and updating organizations, listing the organizations
a user belongs to, managing members and their roles, and resolving the active
organization for a request.

## Migration status

This module is a **work-in-progress migration target**. It is *not* yet the
live/mounted implementation. The authoritative, currently mounted implementation
for this domain still lives in the legacy flat tree:

- `backend/src/routes/` — organization routes
- `backend/src/controllers/` — organization controllers
- `backend/src/services/` — organization services

As the migration progresses, logic is moved out of the legacy flat files and
into this module, and the corresponding legacy route is re-pointed at the
module's exported router. Until that happens for a given endpoint, treat the
legacy flat implementation as the source of truth.

## Public API surface

`index.ts` is the module entry point and re-exports the module's public surface
(router and any shared types/services). Consumers should import from this module
rather than reaching into its internal files.

## Notes for contributors

- When migrating an endpoint, move the logic here and update the legacy route to
  delegate to this module instead of duplicating behavior.
- Keep the legacy flat implementation and this module in sync only during the
  transition; once an endpoint is fully migrated, the legacy copy should be
  removed.
- If you add a new endpoint, prefer adding it here and wiring it up, rather than
  extending the legacy flat tree.
