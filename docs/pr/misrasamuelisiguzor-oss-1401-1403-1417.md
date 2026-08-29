## Title

FE-022–024 / FE-038: Toast context, Skeleton, Spinner/LoadingScreen, RequireAuth guard

## Body

Three Phase 3 UI primitives from the frontend rebuild backlog. Each is a new file with a
co-located test; nothing existing is modified. Not wired into `App.tsx`/`main.tsx` yet, as
there is no shell or router `<Suspense>` to mount them in.

**FE-022 — `ToastContext` provider and `useToast()` hook (`src/contexts/ToastContext.tsx`, new)**

- `useToast()` returns `{ toast, success, error, warning, info, dismiss, dismissAll }`.
  `toast(message, kind?)` returns a string id; the four named helpers are wrappers over it.
- Ids are `toast-<ts>-<seq>` from a monotonic counter, so 50 toasts raised in one tick still
  get 50 distinct ids.
- Duplicate suppression: an identical message raised again within 2s increments a `count` on
  the existing toast (rendered as `×N`) instead of stacking a new row. A synchronous ref
  (`list`) backs the state so several `toast()` calls in one tick dedupe against each other
  before React re-renders.
- Non-`loading` toasts auto-dismiss after 3800ms; every timer handle is tracked in a ref and
  cleared on `dismiss`, `dismissAll`, and provider unmount, so no timer fires `setState`
  after unmount.
- `useToast()` outside a provider throws `"useToast must be used within a ToastProvider"`.
- Renders a bottom-right `role="status" aria-live="polite"` region using framer-motion
  `AnimatePresence`; lucide-react icons per kind, all `aria-hidden`.

Tests (`ToastContext.test.tsx`): ported from the deleted suite to `vi` fake timers and
extended — API shape, out-of-provider throw, unique ids, auto-dismiss timing, loading toast
persistence, targeted `dismiss`, `dismissAll`, dedupe/count, post-window stacking, unmount
timer cleanup.

**FE-023 — `Skeleton` loading primitives (`src/components/ui/Skeleton.tsx`, new)**

- `Skeleton` (box), `SkeletonText` (`lines` prop, last line at `w-3/5`), `SkeletonCard`.
- Uses `animate-pulse-slow`, dropped when framer-motion's `useReducedMotion()` is true so the
  placeholder is static under `prefers-reduced-motion`.
- Every node is `aria-hidden="true"` — the surrounding container owns the loading
  announcement.

Tests (`Skeleton.test.tsx`): line count renders, last-line width, `lines` clamped to >= 1,
reduced motion drops the animation class (and keeps it otherwise), `aria-hidden` on all
three.

**FE-024 — `Spinner` and full-page `LoadingScreen` (`src/components/ui/Spinner.tsx`, new)**

- SVG spinner in `sm|md|lg`, `stroke="currentColor"`, `role="status"` with an
  `aria-label` (default `"Loading"`); the `<svg>` is `aria-hidden`.
- `LoadingScreen` centers a large spinner over `bg-dark-bg` for use as a router
  `<Suspense>` fallback.

Tests (`Spinner.test.tsx`): accessible status name (custom and default), size class per
size, `LoadingScreen` renders the large spinner over the dark background.

**FE-038 - `RequireAuth` guard (`src/components/auth/RequireAuth.tsx`, new)**

- Wraps route content (or `<Outlet />`). While `useAuth().status` is `idle`/`loading` it
  renders `<LoadingScreen />` (from FE-024) - never the login page - so a refresh does not
  flash login for a user who is in fact signed in.
- An unauthenticated user is redirected to `/login?next=<encoded pathname+search>` with
  `replace`.
- Exported `safeNextPath(raw)` is the open-redirect guard for the login page to call on the
  `next` param after auth: it returns the value only when it is a same-origin relative path,
  and maps `https://evil.tld`, `//evil.tld`, `/\evil.tld`, and `/javascript:...` to `/`.
- Optional `roles` prop: a signed-in user lacking every listed role gets a 403 fallback
  (inline; FE-041's `ForbiddenPage` is on another branch) rather than a redirect. `AuthUser`
  has no `roles` field yet, so the check reads it defensively.
- Tests (`RequireAuth.test.tsx`): `safeNextPath` accept/reject cases; LoadingScreen during
  init with no login flash; redirect carries the encoded `next`; authenticated content
  renders; missing-role renders 403 not a redirect.

## Verification

- `npx vitest run src/contexts/ToastContext.test.tsx src/components/ui/Skeleton.test.tsx src/components/ui/Spinner.test.tsx`
  — 21 passed.
- `npx tsc --noEmit` — the three new source files add no errors (`master` already has 28
  pre-existing `tsc` errors in unrelated files; the count is unchanged with this branch).
- `npx eslint` on the three source files — clean. (`npm run lint` over the whole repo
  reports ~1750 pre-existing problems on `master`, so it is not a usable gate; test files
  are excluded from `tsconfig.json` and cannot be linted with the project parser.)

Closes #1401
Closes #1402
Closes #1403
Closes #1417
