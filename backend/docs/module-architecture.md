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
