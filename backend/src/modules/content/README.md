# Content Module

## Scope

The `content` module owns the content domain: content items and the
operations that read and mutate them. It is the `modules/**` counterpart to
the legacy flat implementation of the same domain.

## Migration status

**Work-in-progress migration target.** This module is not yet the live/mounted
implementation. The authoritative, currently mounted implementation of the
content domain is still the legacy flat tree:

- `backend/src/routes` — HTTP route definitions
- `backend/src/controllers` — request handlers
- `backend/src/services` — business logic and data access

`index.ts` in this directory is the module's public entry point and currently
exposes only a stub surface. Treat it as the intended future API, not as the
source of truth for current behavior.

## Relationship to the legacy implementation

This codebase currently carries two parallel implementations of most domains:
the `modules/**` tree (the migration target) and the legacy flat tree (the live
implementation). For the content domain, the legacy flat tree remains
authoritative until the migration is complete. When changing content behavior
today, change the legacy implementation; when migrating, port behavior from the
legacy files into this module and keep the two in sync until the flat tree is
removed.

## Public API surface

See `index.ts` for the module's exported surface. Anything not exported from
`index.ts` is internal to the module and should not be imported directly by
other modules.
