# Fix: `backend/src/modules/health/services/healthMonitor.ts` — Broken Relative Imports

**GitHub Issue:** [#1571](https://github.com/hman38705/socialflow-ai-dashboard/issues/1571)
**Tier:** 🔴 Critical
**Domain:** Backend
**Branch convention:** `fix/modules-health-services-healthMonitor-broken-imports`

---

## Problem

`registerModules(app)` is called unconditionally from `backend/src/app.ts` (line 88). During module loading it transitively `require()`s `backend/src/modules/health/services/healthMonitor.ts`, which contains two broken imports:

```ts
// backend/src/modules/health/services/healthMonitor.ts  (current — broken)
import { alertConfigService } from './alertConfigService';      // ❌ named export does not exist
import { TYPES } from '../config/inversify.config';            // ❌ path does not exist
```

Either broken import is enough to crash the process. Together they cause two distinct `Cannot find module` / `SyntaxError` failures at `require()`-time, preventing `app.ts` from finishing its load and crashing the server on boot.

---

## Root Cause — Import 1: `{ TYPES }` from `'../config/inversify.config'`

`..` from `backend/src/modules/health/services/` lands in `backend/src/modules/health/` — there is no `config/` subdirectory there. The directory only contains:

```
backend/src/modules/health/
├── index.ts
├── README.md
└── services/
```

Reaching `backend/src/config/` requires three levels up:

| `..` traversal | Lands at |
|---|---|
| `..` | `backend/src/modules/health/` |
| `../..` | `backend/src/modules/` |
| `../../..` | `backend/src/` ✅ |

`'../config/inversify.config'` stops two levels too early.

**Actual file on disk:** `backend/src/config/inversify.config.ts` — exports `TYPES`.

> **Note:** `backend/src/modules/health/services/healthService.ts` (same directory) has the **identical** `'../config/inversify.config'` broken import, confirming this is a module-wide migration error. Both files need the same fix.

---

## Root Cause — Import 2: `{ alertConfigService }` from `'./alertConfigService'`

The path `'./alertConfigService'` resolves correctly to `backend/src/modules/health/services/alertConfigService.ts` (the file exists). However, **the named export `alertConfigService` (camelCase instance) does not exist** in that file. The file only exports the class:

```ts
// alertConfigService.ts — actual exports
export class AlertConfigService { ... }   // ✅ PascalCase class
// no `export const alertConfigService = ...` anywhere
```

The camelCase singleton `alertConfigService` is not exported from any file in the codebase. `healthMonitor.ts` calls `alertConfigService.getConfig(...)` and `alertConfigService.canAlert(...)` and `alertConfigService.recordAlert(...)` directly, so the fix must choose one of two approaches (see below).

---

## Affected File

**`backend/src/modules/health/services/healthMonitor.ts`** — current broken imports (lines 4–5):

```ts
import { alertConfigService } from './alertConfigService';      // ❌ no such named export
import { TYPES } from '../config/inversify.config';            // ❌ path does not exist
```

---

## Required Fixes

### Fix 1 — Correct the `TYPES` import path

```ts
// fixed
import { TYPES } from '../../../config/inversify.config';   // ✅ resolves to backend/src/config/inversify.config.ts
```

### Fix 2 — Correct the `alertConfigService` import

**Option A — Add a singleton export to `alertConfigService.ts` (minimal change):**

```ts
// in backend/src/modules/health/services/alertConfigService.ts — add at the bottom:
export const alertConfigService = new AlertConfigService();
```

Then `healthMonitor.ts` keeps its existing import unchanged:

```ts
import { alertConfigService } from './alertConfigService';   // ✅ now resolves to the exported instance
```

**Option B — Switch to class import and instantiate via DI:**

```ts
// in healthMonitor.ts — replace the broken import:
import { AlertConfigService } from './alertConfigService';   // ✅ imports the class
```

Then inject or instantiate `AlertConfigService` through Inversify rather than using a module-level singleton.

Option A is the lower-risk change that keeps the surface area of the fix minimal. Option B is the architecturally cleaner approach if the module is moving fully to DI.

---

## Corrected Import Summary

| Broken import string | Problem | Correct path on disk | Corrected import string |
|---|---|---|---|
| `{ TYPES }` from `'../config/inversify.config'` | Path resolves to non-existent `modules/health/config/` | `backend/src/config/inversify.config.ts` ✅ | `'../../../config/inversify.config'` |
| `{ alertConfigService }` from `'./alertConfigService'` | Named export (camelCase instance) does not exist in that file | `backend/src/modules/health/services/alertConfigService.ts` ✅ (path correct, export missing) | Add singleton export **or** change to `{ AlertConfigService }` |

---

## Related Files Needing the Same `TYPES` Fix

`backend/src/modules/health/services/healthService.ts` contains the identical broken import:

```ts
import { TYPES } from '../config/inversify.config';   // ❌ same wrong depth
```

Fix: `import { TYPES } from '../../../config/inversify.config';`

This file is not tracked in a separate issue but must be corrected in the same PR to avoid a second boot-time crash from the same module.

---

## Working Pattern (Reference)

`backend/src/modules/auth/routes.ts` shows the correct depth from the `modules/` tree to reach `backend/src/`:

```ts
import { sseTicketService } from '../../services/SSETicketService';
import { loginRegisterLimiter } from '../../shared/middleware/authRateLimiters';
```

From `modules/auth/` (one level deep), `../../` reaches `backend/src/`. From `modules/health/services/` (two levels deep), `../../../` is needed.

---

## Acceptance Criteria

- [ ] Every relative import in `healthMonitor.ts` resolves to a real file on disk.
- [ ] `{ alertConfigService }` (or `{ AlertConfigService }`) resolves to an actual export from the target file.
- [ ] `node -e "require('./dist/app.js')"` no longer throws a `Cannot find module` error for this file.
- [ ] `npm run lint` and `npm run build` pass with zero warnings.

## Testing Requirements

- Add/extend a boot test that imports `../app` and asserts it loads without throwing for this module specifically.
- Screenshot of passing Jest terminal logs must be attached to the PR.

## PR Checklist

- [ ] Branch named `fix/modules-health-services-healthMonitor-broken-imports`
- [ ] `healthService.ts` same-depth `TYPES` import also corrected in this PR
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run build` passes with zero warnings
- [ ] Screenshot of passing Jest terminal logs attached to the PR
