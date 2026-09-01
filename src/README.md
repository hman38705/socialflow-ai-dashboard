# Frontend — `src/`

React 19 + Vite single-page app (the "SocialFlow AI Dashboard"). This is a **middle of a rebuild**;
whole feature areas are being ported to the Context + hooks architecture
described below. Where a page or component isn't ported yet, treat the structure documented here as
the target to move toward, not the current ground truth in every file.

Documentation pointers:

- **State management rationale** — why Context + hooks and no state library: [FE-ADR-0001](../docs/adr/0001-frontend-state-management.md)
- **Design tokens / theme** — `docs/accessibility.md` (token–contrast table) and `tailwind.config.js`
- **Performance budget** — `docs/performance-budget.md`
- **Worker/job queue status** — `docs/worker-queue-status.md`

---

## Folder layout

| Path              | Purpose                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.tsx`    | Entry point. Imports `./index.css`, calls `configureApi(...)`, mounts `<App/>`.                                                      |
| `src/App.tsx`     | Router **and** provider composition. This is where providers are nested (see below).                                                 |
| `src/api/`        | **Generated** API client. **Never hand-edit** — see the rule below.                                                                  |
| `src/auth/`       | Hand-written auth orchestration: silent token refresh, session-expiry handling, OAuth CSRF state.                                    |
| `src/contexts/`   | React contexts + their provider components (`Auth`, `Posts`, `Jobs`, `Composer`, …) and hooked accessors (`useAuth`, `usePosts`, …). |
| `src/hooks/`      | Reusable hooks not tied to a single context (`useAnalyticsQuery`, `useJobStream`, `useCredits`, …).                                  |
| `src/components/` | Presentational & feature components, grouped by feature area (`composer/`, `analytics/`, `layout/`, …).                              |
| `src/pages/`      | Route-level page components (`AnalyticsPage`, `LoginPage`, …).                                                                       |
| `src/services/`   | Framework-agnostic domain clients/business logic (analytics, search, translation, draft store, jobs, transactions).                  |
| `src/config/`     | Env config + feature flags (`env.ts`).                                                                                               |
| `src/constants/`  | App constants / shared enums (`ErrorCodes.ts`).                                                                                      |
| `src/types/`      | Frontend type definitions (post, scheduler, predictive, …).                                                                          |
| `src/schemas/`    | Zod schemas for runtime validation (webhooks, …).                                                                                    |
| `src/lib/`        | Framework-agnostic utilities (datetime, hashing, text length, socket client, exporters).                                             |
| `src/utils/`      | Pure helper functions + their `AppError` and hashtag generators.                                                                     |
| `src/features/`   | Feature wiring (e.g. predictive toggle).                                                                                             |
| `src/blockchain/` | Stellar/Soroban wallet & IPFS upload — lazy-loaded only (see performance budget).                                                    |
| `src/test/`       | Shared **test-utils** — the one entrypoint for cross-cutting test helpers (e.g. `a11y`).                                             |

---

## The "never hand-edit `src/api`" rule

`src/api/` is **generated** from `backend/openapi.yaml` by
[`openapi-typescript-codegen`](https://www.npmjs.com/package/openapi-typescript-codegen)
(note the `/* generated … — do not edit */` header on every file). Regenerate it, never patch it:

```bash
# regenerates ./src/api from ./backend/openapi.yaml
npm run generate-client
```

**Do not** manually add, remove, or change models/services in `src/api/`. Consequences of violating
this rule:

- The next `npm run generate-client` **silently clobbers your edit** — and because nothing compares
  the result to what was there, a hand-change that was the _only_ thing fixing a bug will disappear
  with no error.
- Types drift from the real backend contract, so the app type-checks against a spec that doesn't
  exist and fails at runtime against the API that does.

If the generated client is missing something you need:

1. Fix the source of truth first: update `backend/openapi.yaml`.
2. Regenerate with `npm run generate-client`.
3. If a feature genuinely needs widening **and** the spec can't represent it yet (e.g. a 2FA flag the
   OpenAPI model doesn't carry), widen it in the consuming hand-written module — see
   `LoginResponse`/`RegisterResponse` in `src/contexts/AuthContext.tsx` — not by editing the generated
   file. Never add `// @ts-ignore` to work around a generated model.

The generated client is configured once in `src/api/configure.ts` and read via `src/api/index.ts`.
Degraded-behaviour notes for optional subsystems live in the repo-root `README.md` ("Optional
dependency matrix").

---

## Provider nesting order

Providers are composed in `src/App.tsx`, outer → inner:

```
<BrowserRouter>                     (usually the topmost wrapper)
  <AuthProvider>                    # 1 session + silent refresh
    <OrgProvider>                   # 2 active organization
      <ComposerProvider>            # 3 composer modal state
        <JobsProvider>              # 4 background jobs + toasts
          <Routes>…</Routes>
        </JobsProvider>
      </ComposerProvider>
    </OrgProvider>
  </AuthProvider>
</BrowserRouter>
```

Why in this order:

1. **`AuthProvider` outermost (beneath the router)** — everything below it may call `useAuth()` and
   needs to share the single session. It owns the access token (held in a ref, never persisted),
   the refresh token (sessionStorage), the silent-refresh-on-mount flow, and two-factor state. Since
   it must initialize `OpenAPI.TOKEN` before any request fires, it wraps all data-touching
   providers.
2. **`OrgProvider` inside `AuthProvider`** — the active organization is only meaningful once a user
   is authenticated; switching/caching org state depends on having a session. It's _above_ data
   providers because posts/analytics caches are keyed by org and must re-key when the org changes.
3. **`ComposerProvider` next** — the composer is a page-level concern that needs auth + org context
   (to know who's publishing and into which org), but doesn't need background-job state.
4. **`JobsProvider` innermost of the feature providers** — background jobs (transcoding, TTS, exports)
   and their toasts are visual chrome shown in the layout _around_ the routed content, so it wraps
   `<Routes>`. It has no dependency on composer state, so it sits below it.

> The intended order is the one that appears in `src/App.tsx`. The rebuild is in progress; a
> `useX` hook throwing `…must be used within a XProvider` at runtime is the signal that a provider
> is either not mounted yet or wrapped on the wrong side of its consumers. Mount these once at the
> app root (never per-page) so state survives route navigation.

Rules of thumb that keep the order correct:

- Providers whose state must **survive route changes** live **above** `<Routes>`.
- A provider that **reads another provider's state** must be nested **inside** it.
- A provider that **only renders UI chrome** (`JobsProvider` toasts) lives just above the routes, not
  above providers that don't need it.

See [FE-ADR-0001](../docs/adr/0001-frontend-state-management.md) for _why_ this is Context rather than
a global state library.

---

## Token usage

The app uses short-lived access + refresh JWTs from `POST /auth/login`. Storage rules:

| Token             | Where it lives                                                                                       | Why                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Access token**  | In memory only — a `useRef` in `AuthContext`; never persisted to `localStorage` or `sessionStorage`. | Keeps the bearer token out of persistent storage, shrinking the XSS exfiltration surface.                                                   |
| **Refresh token** | `sessionStorage` (`sf_refresh_token`); registers the user email under `sf_user_email`.               | Must survive a page reload for silent-refresh-on-mount, but **must not** survive a tab close or be readable cross-tab as a durable session. |

Key flows (all in `src/auth/`, orchestrated through `AuthContext`):

- **`configureApi`** (`src/api/configure.ts`) — called once in `main.tsx`. Sets `OpenAPI.BASE` from
  `VITE_API_URL`, wires `OpenAPI.TOKEN` to the current access token, installs the fetch
  **refresh interceptor** (`withRefreshInterceptor`), and schedules a proactive refresh if a token
  already exists.
- **Silent refresh** (`src/auth/refresh.ts`) — on mount and on any `401`, a **single-flight**
  refresh runs (`refreshTokens`): concurrent callers await the same in-flight promise. A successful
  refresh replaces tokens and schedules the next proactive refresh (~60 s before `exp` when the tab
  is visible). A failed refresh clears tokens, dispatches `session:expired`, and redirects to
  `/login?next=…`.
- **Exempting refresh calls** — requests to `/auth/refresh` are never intercepted (avoids infinite
  recursion); the refresh call is also tagged with `X-Refresh-Exempt`.
- **OAuth** (`src/auth/oauthState.ts`) — the provider `state` is single-use CSRF protection stored
  in `sessionStorage` and consumed (deleted) on the callback, so a replayed callback can never
  verify twice.

Never add your own token storage: if you think a token should live somewhere it isn't today, talk to
the auth maintainers first — the current split (access in memory, refresh in `sessionStorage`) is a
deliberate security trade-off documented here and in `src/contexts/AuthContext.tsx`.

---

## Test-utils entrypoint

Test-only modules that are shared across the app's suites live in `src/test/`. **Import from
`src/test/`, the single entrypoint — do not reach into `@testing-library` or `axe-core` by hand for
shared assertions.**

The canonical path alias is `@/`, which maps to `src/` (see `tsconfig.json`, `vite.config.ts`, and
`vitest.config.ts`):

```ts
import { expectNoA11yViolations } from '@/test/a11y';
```

What's here today:

- `src/test/a11y.ts` — `expectNoA11yViolations(container, options?)`, a thin wrapper around
  `axe-core`. Fails the test on any `serious`/`critical` violation and logs lower-impact ones as
  warnings. Every page-level component test should call it once. Documented in `docs/accessibility.md`.

Global test setup lives in `jest.setup.js` (`vitest.setup` configured in `vitest.config.ts`): it
installs `jest-dom` matchers, polyfills `TextEncoder`/`TextDecoder`, `crypto.getRandomValues`
(for `@noble/hashes`), and `ResizeObserver` (for Recharts in jsdom).

> n.b. Jest vs Vitest: backend suites run under Jest; the frontend runs under **Vitest** with React
> Testing Library (`@testing-library/react`). `vitest.config.ts`/`vite.config.ts` scope the frontend
> config. When adding a helper to `src/test/`, keep it framework-agnostic so both the Vitest
> component suites and any future suites can share it.

---

## Development

```bash
npm run dev            # Vite dev server (proxy /api -> localhost:3001)
npm run build          # tsc && vite build (also emits bundle report)
npm test  / npm run test:run   # Vitest
npm run lint           # ESLint
```
