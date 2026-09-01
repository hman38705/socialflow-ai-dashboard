# FE-ADR-0001 — Frontend state management: Context + hooks over a state library

- **Status:** Accepted
- **Date:** 2026 (frontend rebuild, Phase 1 — Foundation)
- **Deciders:** Frontend team
- **Context:** the frontend rebuild (the React 19 + Vite SPA at `src/`)

## Decision

The frontend manages shared state with **React Context + hooks**, defined as provider/\_hook pairs in
`src/contexts/` (e.g. `AuthProvider`/`useAuth`, `PostsProvider`/`usePosts`). We are **not** adding a
third-party global state library (Redux, Zustand, Jotai, MobX, TanStack Query, etc.) to the SPA.

## Why — the problem Context + hooks are replacing

Prior state handling was scattered: ad-hoc `useState` + `localStorage` reads spread across page
components, duplicated fetch/caching logic, and event-driven hackery to share state between
unrelated components. That produced:

- **No single source of truth** for shared data (posts, org, session), so one mutation updated some
  screens but not others.
- **No shared formatting/persistence rules** — every consumer re-decided _how_ a piece of state was
  stored and shaped.
- **Logic coupled to the render tree**, making it impossible to reuse a data flow outside one page.

## Why Context instead of a state library

1. **Fewer moving parts, less code to ship.** React's built-in Context covers the vast majority of
   the rebuild's needs — auth session, active org, composer draft, background jobs, and a
   paginated posts cache. Introducing Redux/Zustand adds a second mental model, a second debugger,
   and a second way to reach the same data, without removing any dependency on Context for the parts
   that still need it (CRUD + reusable hooks use it regardless).

2. **Type safety is free and scoped.** A `Context` is an explicitly typed interface; the provider
   implements it and the hook (`useAuth`) narrows access. There's no selector/reducer typing surface
   to keep in sync, and the "must be used within a provider" guard turns wiring mistakes into
   loud, obvious errors at runtime.

3. **No extra dependency risk.** This codebase is intentionally picky about bundles (see
   `docs/performance-budget.md`) and about keeping generated/synced state — both argued against
   adding a whole state runtime for state we can express with `createContext` + `useReducer`.

4. **The genuinely hard parts are isolated to where a library _would_ earn its place — and they
   don't need one.** The two things a state library is usually chosen for — **server-cache freshness**
   and **server cache invalidation across org switches** — are handled in code:
   - `PostsContext` dedups in-flight requests by key (`filterKey:page:limit`) and implements
     optimistic create/update/delete with snapshot rollback on failure.
   - `OrgProvider` broadcasts `org:changed`; org-scoped caches subscribe and re-key. This is the
     classic TanStack Query/SWR use-case, but the rebuild only has **one** such cache (posts) in
     that shape, and scaling it via hooks is cheaper than adding a cache framework for it.

5. **Fits the rebuild's incremental nature.** Context needs no central store wiring or migration —
   a provider can be mounted in `App.tsx` and adopted component-by-component, which matches how
   pages are being ported. A state library would force one big-bang adoption across all consumers at
   once.

### Trade-offs we accepted

- Re-render granularity is coarser than Zustand's selector subscriptions: any context value change
  re-renders every consumer. We mitigate by splitting contexts by domain (`Auth` vs `Posts` vs
  `Jobs`, …) and memoizing values with `useMemo`, so a change to auth doesn't re-render posts.
- We own cache/refetch logic ourselves (`PostsContext` above) instead of leaning on a library's
  defaults.

## Revisit criteria

Add a state library **only if / when** these become true and the Context implementation is clearly
fighting them:

- Two or more distinct **server-cache** shapes with cross-cutting invalidation and stale-while-revalidate
  (not just the current single posts cache), or
- Cross-consumer **deduplication/optimistic semantic** that can't be expressed with `useReducer`, or
- Re-render granularity provably becomes a measurement problem (profiled, not assumed).

Until then: **no new state libraries in the SPA**. Prefer a new `Context`/provider pair in
`src/contexts/`, or a feature hook in `src/hooks/`.

## Consequences

- Shared state lives as typed context + hook pairs, composed once in `src/App.tsx` in the documented
  nesting order (see `src/README.md`).
- New shared state follows the existing pattern: `createContext`, a `Provider` that owns the `useState`
  / `useReducer`, and a `useX` accessor with a provider-missing guard.
- Bundle budget is unaffected (no state-library runtime added).
