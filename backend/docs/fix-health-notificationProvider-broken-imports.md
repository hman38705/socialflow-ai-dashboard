# Fix: `backend/src/modules/health/services/notificationProvider.ts` — Broken Relative Import

**GitHub Issue:** [#1570](https://github.com/hman38705/socialflow-ai-dashboard/issues/1570)
**Tier:** 🔴 Critical
**Domain:** Backend
**Branch convention:** `fix/modules-health-services-notificationProvider-broken-imports`

---

## Problem

`registerModules(app)` is called unconditionally from `backend/src/app.ts` (line 88). During module loading it transitively `require()`s `backend/src/modules/health/services/notificationProvider.ts`, which contains the following broken import:

```ts
// backend/src/modules/health/services/notificationProvider.ts  (current — broken)
import { createLogger } from '../lib/logger';
```

`..` from `backend/src/modules/health/services/` lands in `backend/src/modules/health/` — there is no `lib/` subdirectory there. The directory only contains:

```
backend/src/modules/health/
├── index.ts
├── README.md
└── services/
```

This is a hard `Cannot find module '../lib/logger'` error at `require()`-time. The Node process cannot finish loading `app.ts` and the server crashes on boot.

---

## Root Cause

The file was authored (or migrated) with an import depth of `../` instead of `../../../`. From `backend/src/modules/health/services/`, reaching `backend/src/lib/` requires traversing three levels up:

| `..` traversal | Lands at |
|---|---|
| `..` | `backend/src/modules/health/` |
| `../..` | `backend/src/modules/` |
| `../../..` | `backend/src/` ✅ |

`'../lib/logger'` stops one level too early, pointing into the non-existent `modules/health/lib/`.

> **Note:** This is the identical root cause as [issue #1569](https://github.com/hman38705/socialflow-ai-dashboard/issues/1569) (`alertConfigService.ts`). Both files were migrated with the same incorrect depth.

---

## Affected File

**`backend/src/modules/health/services/notificationProvider.ts`** — current broken import (line 3):

```ts
import { createLogger } from '../lib/logger';   // ❌ path does not exist
```

---

## Logger File Location on Disk

| Path | Exports | Status |
|---|---|---|
| `backend/src/lib/logger.ts` | `createLogger` | ✅ exists — canonical location |
| `backend/src/shared/lib/logger.ts` | `createLogger` | ✅ exists — shared alias |

Use `backend/src/lib/logger.ts` to match the pattern used across the rest of the codebase.

---

## Working Pattern (Reference)

`backend/src/modules/auth/routes.ts` shows the correct depth from the `modules/` tree to reach `backend/src/`:

```ts
import { sseTicketService } from '../../services/SSETicketService';   // modules/auth → src/services
import { loginRegisterLimiter } from '../../shared/middleware/authRateLimiters';
```

Auth's `routes.ts` is one level shallower than the health `services/` subdirectory. From `modules/health/services/`, one extra `../` is needed — hence `../../../`.

---

## Required Fix

```ts
// backend/src/modules/health/services/notificationProvider.ts  (fixed)
import { createLogger } from '../../../lib/logger';   // ✅ resolves to backend/src/lib/logger.ts
```

---

## Corrected Import Summary

| Broken import string | Resolved (wrong) path | Correct path on disk | Corrected import string |
|---|---|---|---|
| `'../lib/logger'` | `modules/health/lib/logger` ❌ | `backend/src/lib/logger.ts` ✅ | `'../../../lib/logger'` |

---

## Acceptance Criteria

- [ ] Every relative import in `notificationProvider.ts` resolves to a real file on disk.
- [ ] `node -e "require('./dist/app.js')"` no longer throws a `Cannot find module` error for this file.
- [ ] `npm run lint` and `npm run build` pass with zero warnings.

## Testing Requirements

- Add/extend a boot test that imports `../app` and asserts it loads without throwing for this module specifically.
- Screenshot of passing Jest terminal logs must be attached to the PR.

## PR Checklist

- [ ] Branch named `fix/modules-health-services-notificationProvider-broken-imports`
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run build` passes with zero warnings
- [ ] Screenshot of passing Jest terminal logs attached to the PR
