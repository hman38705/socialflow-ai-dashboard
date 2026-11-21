# Backend Module Architecture

## Overview

The backend currently has two parallel layouts that exist simultaneously during an in-progress migration from a flat structure to a domain-module structure. This document is the canonical reference for where code lives, which layout is authoritative, and how to contribute without creating new duplication.

---

## Canonical layout (use this for all new code)

The **module layout** under `src/modules/` is the target architecture. Each domain module owns its routes, services, controllers, and middleware in one place.

```
src/modules/
  auth/           controllers/, middleware/, routes.ts
  billing/        services/, routes.ts
  content/        services/, routes.video.ts, routes.translation.ts, routes.tts.ts
  health/         services/, routes.ts
  organization/   controllers/, routes.ts, routes.roles.ts
  social/         services/, routes.facebook.ts, routes.youtube.ts
  webhook/        services/, routes.ts
  analytics/      routes.ts
```

All modules are registered in `src/modules/index.ts` via `registerModules()`.

Supporting infrastructure that is shared across modules lives in `src/shared/`:

```
src/shared/
  config/     circuitBreaker.config.ts, cors.ts, inversify.config.ts, tts.config.ts, video.config.ts
  lib/        errors.ts, eventBus.ts, logger.ts, prisma.ts
  middleware/ audit.ts, authMiddleware.ts, checkPermission.ts, error.ts, orgMiddleware.ts,
              prismaSoftDelete.ts, requestId.ts, requireCredits.ts, tracingMiddleware.ts, validate.ts
  schemas/    auth.ts, tts.ts, webhooks.ts
  types/      circuitBreaker.ts, predictive.ts, translation.ts, tts.ts, video.ts
  utils/      BaseRepository.ts, initDirectories.ts, UnitOfWork.ts
```

---

## Deprecated directories (do not add new files here)

The following flat directories are deprecated. They exist only because the migration is not yet complete. No new files should be added to them.

| Deprecated path | Canonical replacement | Status |
|---|---|---|
| `src/routes/` (except `v1/`) | `src/modules/<domain>/routes*.ts` | Deprecated — routes diverged; migrate per domain |
| `src/services/` | `src/modules/<domain>/services/` | Deprecated — most files identical; migrate on next touch |
| `src/middleware/` | `src/shared/middleware/` | Deprecated — most files identical; migrate on next touch |
| `src/config/` (non-app files) | `src/shared/config/` | Deprecated — all files identical; migrate on next touch |
| `src/types/` | `src/shared/types/` | Deprecated — all files identical; migrate on next touch |
| `src/schemas/` | `src/shared/schemas/` | Deprecated — files diverged; use `src/shared/schemas/` |
| `src/lib/` | `src/shared/lib/` | Deprecated — some files diverged; use `src/shared/lib/` |
| `src/controllers/` | `src/modules/<domain>/controllers/` | Deprecated — migrate on next touch |
| `src/repositories/` | `src/shared/utils/BaseRepository.ts` | Deprecated — migrate on next touch |
| `src/tests/` | `src/__tests__/` | Deprecated — use `src/__tests__/` |

### Known diverged files

These pairs exist in both locations but are **not identical**. The `src/shared/` or `src/modules/` copy is authoritative:

| File | Flat (deprecated) | Module (canonical) | Note |
|---|---|---|---|
| `logger.ts` | `src/lib/logger.ts` | `src/shared/lib/logger.ts` | Shared copy is trimmed; flat copy has extra transports |
| `prisma.ts` | `src/lib/prisma.ts` | `src/shared/lib/prisma.ts` | Flat copy has read-replica support not yet in shared |
| `authMiddleware.ts` | `src/middleware/authMiddleware.ts` | `src/shared/middleware/authMiddleware.ts` | Flat copy has additional claims handling |
| `circuitBreaker.config.ts` | `src/config/circuitBreaker.config.ts` | `src/shared/config/circuitBreaker.config.ts` | Flat copy has extra provider entries |
| `schemas/webhooks.ts` | `src/schemas/webhooks.ts` | `src/shared/schemas/webhooks.ts` | Flat copy has additional event types |
| `schemas/auth.ts` | `src/schemas/auth.ts` | `src/shared/schemas/auth.ts` | Minor field differences |
| `FacebookService.ts` | `src/services/FacebookService.ts` | `src/modules/social/services/FacebookService.ts` | Flat copy has additional methods |
| `TwitterService.ts` | `src/services/TwitterService.ts` | `src/modules/social/services/TwitterService.ts` | Flat copy has additional methods |

When migrating a diverged file, reconcile both copies — do not simply overwrite.

### Migration timeline

The flat directories are targeted for removal once all routes are fully migrated to `src/modules/`. There is no hard deadline, but the expectation is:

- Any PR that touches a file in a deprecated directory should move that file to its canonical location as part of the same PR, unless the scope makes that impractical.
- The `src/routes/v1/index.ts` router (which currently drives the live app) will be replaced by `registerModules()` once all route migrations are verified.

---

## Live request path

The app (`src/app.ts`) mounts `src/routes/v1/index.ts` as the active router for both `/api/v1` and the legacy `/api` prefix. `registerModules()` from `src/modules/index.ts` is **not yet wired into the app** — it exists in parallel and is the migration target.

```
app.ts
  └── /api/v1  →  routes/v1/index.ts   ← LIVE (flat layout)
  └── /api     →  routes/v1/index.ts   ← LIVE legacy alias (deprecated header set)

modules/index.ts → registerModules()   ← TARGET (not yet mounted)
```

---

## Realtime / SSE

The realtime stream is served over Server-Sent Events (SSE). Because `EventSource` cannot send custom headers, clients cannot present a bearer token on the stream request itself. Instead the stream is authenticated with a short-lived, single-use **SSE ticket** that the client obtains over an authenticated HTTP call and then passes as a query parameter when opening the stream.

### SSE ticket lifecycle

Tickets are issued and redeemed by the ticket service used by the realtime stream (see the ticket service source for the exact TTL, sweep interval and cap constants).

| Stage | Behaviour |
|---|---|
| Issuance | An authenticated request asks the ticket service for a ticket. The service generates an opaque ticket id, records it in an in-memory map with an expiry timestamp, and returns it to the client. |
| Redemption | The stream endpoint redeems the ticket exactly once. A successful redemption removes the ticket from the map, so replaying the same ticket fails. |
| TTL expiry | Each ticket carries a short TTL. A ticket that is not redeemed before its expiry is treated as invalid and cannot be redeemed. |
| Periodic sweep | A timer periodically walks the map and drops expired tickets so unredeemed tickets do not accumulate. The sweep interval is `unref`'d, so it never keeps the process alive on its own. |
| Size cap | The map is bounded by a maximum size. When the cap is reached, the oldest entries are evicted first (insertion order) to make room for new tickets. |

Tickets are **per-process**: they live in an in-memory map on the instance that issued them. A ticket issued by one replica cannot be redeemed on another, so stream requests must be routed to the issuing instance (or the client must re-request a ticket). Sharing tickets across replicas via Redis is a separate distributed-state concern and is out of scope here.

---

## Admin endpoint validation

The admin routes (`src/admin/`) are the highest-privilege surface in the app. Their numeric guards live in `src/admin/constants.ts` and are enforced by the handlers in `cacheAdminService.ts`, `jobAdminService.ts`, and `migrationService.ts`. The rules below document current behaviour only — changing a bound requires updating this section and the executable spec.

### Numeric parameters

| Parameter | Endpoint(s) | Default | Accepted range | Notes |
|---|---|---|---|---|
| `limit` | Cache clear, job retry | `DEFAULT_LIMIT` | `1` – `MAX_LIMIT` | Must be a positive integer; values above `MAX_LIMIT` are rejected |
| `batchSize` | Job retry | `DEFAULT_BATCH_SIZE` | `1` – `MAX_BATCH_SIZE` | Must be a positive integer; values above `MAX_BATCH_SIZE` are rejected |
| `dryRun` | Migration run/rollback | `false` | `true` / `false` | Boolean flag; when `true` the operation is simulated and no state is mutated |
| `force` | Migration run/rollback | `false` | `true` / `false` | Boolean flag; required to bypass the force guard (see below) |

The concrete values for `DEFAULT_LIMIT`, `MAX_LIMIT`, `DEFAULT_BATCH_SIZE`, and `MAX_BATCH_SIZE` are defined in `src/admin/constants.ts` and are the single source of truth. Any change to those constants must be reflected here.

### Cache-clear pattern allowlist

Cache-clear requests accept an optional `pattern` used to scope which keys are evicted. Only patterns on the allowlist in `src/admin/constants.ts` are accepted; any pattern not on the allowlist is rejected before the cache is touched. This prevents arbitrary wildcard eviction of unrelated keys.

### Migration force guard

Migration run and rollback require an explicit `force: true` to proceed against a non-empty or otherwise guarded target. Without `force`, the handler refuses the operation and returns an error rather than mutating migration state. Combined with `dryRun`, callers can preview the effect of a forced migration before applying it.

### Executable specification

The authoritative, executable form of these rules lives in the admin test suites:

- `src/__tests__/adminRoutes.test.ts` — route-level validation of `limit`, `batchSize`, `dryRun`, and `force`.
- `src/__tests__/jobAdminService.test.ts` — service-level bounds for job retry batching.

The HTTP contract (request/response shapes and error codes) is described in `openapi.yaml` at the backend root. When the bounds in `src/admin/constants.ts` change, update this section, the OpenAPI spec, and the tests together.

---

## Admin audit log contract

Admin mutations write structured audit entries through the shared audit middleware (`src/shared/middleware/audit.ts`). This section is the written contract for new admin endpoints and for reviewers verifying completeness. It is exercised by `src/__tests__/audit.test.ts` and `src/__tests__/auditRedaction.test.ts`.

This section documents the contract only. Implementing the audit writes is tracked by the admin audit-log issue in the current batch, and the audit log data model and retention policy are out of scope here.

### Admin mutations that must be audited

Every admin mutation that changes state must write exactly one audit entry. The stable action identifiers below are the values written to the `action` field; new admin routes must follow the same `admin.<domain>.<verb>` naming.

| Mutation | Action identifier | `targetType` | Description |
|---|---|---|---|
| Cache clear | `admin.cache.clear` | `cache` | Flushes application caches via the admin cache endpoint |
| Job retry | `admin.job.retry` | `job` | Re-enqueues a failed background job |
| Migration run | `admin.migration.run` | `migration` | Applies pending database migrations |
| Migration rollback | `admin.migration.rollback` | `migration` | Rolls back the most recent migration |
| Config PUT | `admin.config.update` | `config` | Updates runtime configuration values |

Read-only admin endpoints (list, get, status) do not write audit entries. Any new admin mutation must be added to this table in the same PR that introduces it.

### Required audit entry fields

| Field | Required | Description |
|---|---|---|
| `actorId` | Yes | ID of the authenticated user performing the mutation |
| `actorEmail` | Yes | Email of the acting user (redacted where required) |
| `actorRole` | Yes | Role of the acting user at the time of the action |
| `action` | Yes | Stable action identifier from the table above (e.g. `admin.cache.clear`) |
| `targetType` | Yes | Type of the resource acted on (e.g. `cache`, `job`, `migration`, `config`) |
| `targetId` | When applicable | Identifier of the affected resource |
| `statusCode` | Yes | Response status code returned to the caller — the outcome of the mutation |
| `method` | Yes | HTTP method of the originating request |
| `path` | Yes | Request path of the originating request |
| `ip` | Yes | Client IP address of the request |
| `userAgent` | Yes | Client user agent of the request |
| `requestId` | Yes | Correlation ID propagated from the request middleware |
| `metadata` | Yes | Action-specific details (redacted per `auditRedaction.test.ts`) |
| `createdAt` | Yes | Timestamp when the audit entry was written |

The outcome of a mutation is captured by `statusCode`: a 2xx status records a successful mutation, while a 4xx/5xx status records a failed or rejected attempt. The entry is written in both cases.

Sensitive values inside `metadata` (tokens, secrets, credentials) are redacted before persistence; see `src/__tests__/auditRedaction.test.ts` for the redaction contract.

### Where the audit write belongs

The audit write belongs in the shared audit middleware, not in individual handlers. The middleware is mounted on the admin router so that it observes every admin request, and it writes the entry **after the handler resolves, on response finish**, capturing the outcome status from the response:

```
authenticate → checkPermission → validate(schema, target) → route handler → response finish → audit write
```

Because the write happens on response finish, the entry reflects the actual outcome (`statusCode`) rather than the intent of the request. Handlers must not write audit entries themselves; they only supply action-specific details through `metadata` (for example the job id or migration name) so the middleware can record them.

When adding a new admin route, mount it behind the shared audit middleware and add its action identifier to the table above — do not write audit entries inside the handler.

---

## Contribution guidelines

**Adding a new feature:**
- Create it inside the appropriate `src/modules/<domain>/` directory.
- If no domain module fits, create a new one following the existing pattern (routes file + optional `services/` subdir + `index.ts` export).
- Do not add new files to `src/routes/`, `src/services/`, `src/middleware/`, `src/config/`, `src/types/`, or `src/schemas/`.

**Modifying an existing feature:**
- If the file you need is in a deprecated directory, check whether a canonical copy exists in `src/shared/` or `src/modules/`.
- If the copies are identical, make your change in the canonical location and update any imports in the deprecated location to re-export from the canonical path (or remove the deprecated copy if imports allow).
- If the copies are diverged (see table above), make your change in the canonical location and note the divergence in your PR so it can be reconciled.

**Imports:**
- Always import shared infrastructure from `src/shared/` (e.g. `import { createLogger } from '../shared/lib/logger'`).
- Never import from a deprecated flat directory in new code.

**Tests:**
- Unit and integration tests go in `src/__tests__/`. Do not add new tests to `src/tests/`.

---

## Admin module

Admin routes live in `src/routes/admin.ts` and are the highest-privilege surface in the API. Every admin route is mounted behind `authenticate` and `checkPermission`, and any route that accepts numeric input must also validate it before the handler runs.

### Admin numeric input validation

Numeric query and body inputs on admin routes — `limit`, `batchSize`, `dryRun`, and `force` — are validated with Zod schemas applied through the shared `validate(schema, target)` middleware in `src/shared/middleware/validate.ts` (the deprecated copy at `src/middleware/validate.ts` re-exports the same behaviour; import from `src/shared/` in new code).

**Pipeline position.** The middleware sits after `authenticate` and `checkPermission` and before the route handler, so unauthenticated or unauthorised requests are rejected first and only well-formed numeric input reaches the handler:

```
authenticate → checkPermission → validate(schema, 'query' | 'body') → route handler
```

**Rejection response.** When validation fails the middleware short-circuits the request and responds with HTTP `422` and a JSON body of the form:

```json
{ "errors": [{ "field": "<dot.path>", "message": "<string>" }] }
```

`field` is the dot-separated path of the offending input (for example `query.limit`) and `message` is a human-readable description. This shape matches the assertions in `src/__tests__/validate.test.ts` and the `Error` schema in `openapi.yaml`.

**Success behaviour.** On success the parsed and coerced value replaces `req.body` or `req.query` (whichever `target` was specified), so handlers can rely on numeric fields already being numbers rather than strings.

When adding a new admin route, define a Zod schema for its numeric inputs and mount `validate(schema, target)` in the chain above — do not parse or coerce numeric inputs inside the handler.
