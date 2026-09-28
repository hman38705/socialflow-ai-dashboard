# Fix: `backend/src/modules/health/routes.ts` — Missing File & Broken Import

**GitHub Issue:** [#1568](https://github.com/hman38705/socialflow-ai-dashboard/issues/1568)
**Tier:** 🔴 Critical
**Domain:** Backend
**Branch convention:** `fix/modules-health-routes-broken-imports`

---

## Problem

`registerModules(app)` is called unconditionally from `backend/src/app.ts` (line 88). It attempts to `require()` `backend/src/modules/health/routes.ts`, but **that file does not exist** in the health module. The health module currently contains only:

```
backend/src/modules/health/
├── index.ts          ← marks module as WIP, does not export routes
├── README.md
└── services/
```

When the import in `routes.ts` is authored (or resolved by the module index), it will also reference:

```ts
import { getHealthService, getHealthMonitor, getAlertConfigService } from '../services/serviceFactory';
```

That path resolves to `backend/src/modules/health/services/serviceFactory.ts`, which **does not exist**. The canonical service factory lives at `backend/src/services/serviceFactory.ts` — three directory levels up from the future `routes.ts` file location.

Because this is a hard `Cannot find module` error at `require()`-time, the Node process cannot finish loading `app.ts` and the server crashes on boot.

---

## Root Cause

The health module is a work-in-progress migration target (documented in its own `index.ts`). The legacy routes and services remain in the flat `backend/src/{routes,controllers,services}` tree. When `registerModules(app)` was added to `app.ts`, it assumed the health module was complete, turning an inert WIP into a live boot crash.

The secondary cause is the incorrect relative import depth. From `backend/src/modules/health/routes.ts`:

| `..` traversal | Lands at |
|---|---|
| `..` | `backend/src/modules/health/` |
| `../..` | `backend/src/modules/` |
| `../../..` | `backend/src/` |

`'../services/serviceFactory'` resolves to `backend/src/modules/health/services/serviceFactory` — one level short of the actual file.

---

## Working Pattern (Reference)

`backend/src/modules/auth/routes.ts` demonstrates the correct depth:

```ts
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { sseTicketService } from '../../services/SSETicketService';
import { loginRegisterLimiter } from '../../shared/middleware/authRateLimiters';
```

From `modules/auth/routes.ts`, `../../` reaches `backend/src/`. The same `../../` depth applies to `modules/health/routes.ts` since both sit at the same level.

---

## Required Fix

### Step 1 — Create `backend/src/modules/health/routes.ts`

The file must be created. Import paths must use `../../` to reach `backend/src/`:

```ts
// backend/src/modules/health/routes.ts
import { Router } from 'express';
import { getHealthService, getHealthMonitor, getAlertConfigService } from '../../services/serviceFactory';
// add further controller/middleware imports using ../../ depth
```

### Step 2 — Verify `registerModules` wires the health router

Confirm that the health module's `index.ts` (or the central `modules/index.ts`) exports the router so `app.ts` can mount it.

---

## Corrected Import Depth Summary

| Broken import string | Resolved (wrong) path | Correct path on disk | Corrected import string |
|---|---|---|---|
| `'../services/serviceFactory'` | `modules/health/services/serviceFactory` ❌ | `backend/src/services/serviceFactory.ts` ✅ | `'../../services/serviceFactory'` |

---

## Acceptance Criteria

- [ ] `backend/src/modules/health/routes.ts` exists and every import in it resolves to a real file on disk.
- [ ] `node -e "require('./dist/app.js')"` no longer throws a `Cannot find module` error for this file.
- [ ] `npm run lint` and `npm run build` pass with zero warnings.

## Testing Requirements

- Add/extend a boot test that imports `../app` and asserts it loads without throwing for this module specifically.
- Screenshot of passing Jest terminal logs must be attached to the PR.

## PR Checklist

- [ ] Branch named `fix/modules-health-routes-broken-imports`
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run build` passes with zero warnings
- [ ] Screenshot of passing Jest terminal logs attached to the PR
