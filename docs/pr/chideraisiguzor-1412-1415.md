## Title

FE-033-036: App shell - DashboardLayout, Sidebar, Topbar, NotificationsPanel

## Body

The Phase 4 app-shell layer. Four new files under `src/components/layout/`, each with a
co-located test. Nothing existing is modified.

### Substitutions for dependencies not yet on `master`

These ACs reference components that only exist in other open PRs or not at all. To keep this
PR self-contained, the equivalent behaviour is implemented inline and each spot is a clean
seam to swap later:

- `Icon` (FE-032) / `DropdownMenu` (FE-031) - lucide-react icons are used directly; the
  Sidebar user menu is a small inline `role="menu"` popup.
- `EmptyState` (FE-025) - the "all caught up" state in `NotificationsPanel` is inline.
- `Drawer` (FE-040) - `NotificationsPanel` renders its own fixed right-side dialog with a
  backdrop and Escape handling.
- Command palette (FE-039) - `Topbar` exposes an `onOpenCommandPalette` prop (no-op default)
  and renders the `⌘K` hint.
- Socket feed (FE-107) - `NotificationsPanel` takes a `NotificationsSource`
  (`items` + `persistMarkRead` + `persistMarkAllRead`); the default is an in-memory source,
  and FE-107 replaces just that object.

**FE-033 - `DashboardLayout` (`src/components/layout/DashboardLayout.tsx`)**

- CSS grid: `grid-cols-1 md:grid-cols-[auto_1fr]`, `h-screen`; every region except `<main>`
  is fixed-height, so `<main class="overflow-y-auto">` is the only vertical scroller.
- Renders `<Outlet />` for use as a React Router layout route.
- Landmarks: `<header>` (Topbar), `<nav aria-label="Main">` + `<aside>` (Sidebar),
  `<main id="main">` - exactly one `<main>`.
- Skip-to-content link is the first focusable node, `sr-only` until focused.
- Below `md` the grid is one column and the sidebar becomes an overlay drawer toggled from
  the Topbar hamburger (layout owns the `mobileNavOpen` state).
- Tests: routed `<Outlet>` content renders; a single `<main>`; the skip link targets `#main`.

**FE-034 - `Sidebar` (`src/components/layout/Sidebar.tsx`)**

- `<nav aria-label="Main">` wrapping a `<ul>`/`<li>` of `NavLink`s: Analytics, Scheduler,
  Predictor, Settings, each with a lucide icon. The active link gets the `primary-blue`
  token and `aria-current="page"` (from `NavLink`).
- Collapsible to a 4rem icon rail; the collapsed flag persists in `localStorage`
  (`sf.sidebar.collapsed`) and collapsed links keep their name via `title` + an `sr-only`
  label.
- Brand block at the top; a bottom user block whose menu (inline `role="menu"`) has the
  email and a Sign out item calling `logout()` from `useAuth`.
- Tests: active link `aria-current`; collapsed state survives a remount; Sign out calls the
  auth context.

**FE-035 - `Topbar` (`src/components/layout/Topbar.tsx`)**

- Left: the page title from `titleForPath(pathname)` (exported; longest-prefix match, falls
  back to "Dashboard") - the single source of truth for titles. `document.title` is kept in
  sync via an effect. The title truncates.
- Center: a search trigger showing the `⌘K` hint, calling `onOpenCommandPalette`.
- Right: "New post" -> `useComposer().openComposer()`, `<NotificationsPanel />`,
  `<OrgSwitcher />`.
- Sticky with `backdrop-blur`.
- Tests: `titleForPath` prefix logic; the heading and `document.title` track the route; the
  New post button opens the composer.

**FE-036 - `NotificationsPanel` (`src/components/layout/NotificationsPanel.tsx`)**

- Bell button with an unread badge capped visually at "9+"; its accessible name carries the
  exact count ("12 unread notifications").
- Opens a right-side dialog (backdrop + Escape), notifications grouped into **Today** /
  **Earlier** by start-of-day, unread items carrying a rose dot.
- "Mark all as read" and per-item read-on-click are optimistic: state updates immediately,
  and a rejected `persist*` call rolls the state back. Exported `groupByRecency` and
  `unreadLabel` helpers are unit-tested.
- Empty state when there are no notifications.
- Live updates (FE-107) are out of scope; the `NotificationsSource` seam is where the socket
  (with polling fallback) will attach.
- Tests: grouping split; label count; capped badge with exact spoken count; drawer groups;
  mark-all optimistic success and rollback-on-failure.

## Verification

- `npx vitest run src/components/layout` - 16 passed across 4 files.
- `npx tsc --noEmit` - the four new source files add no errors (`master` already has 28
  pre-existing `tsc` errors elsewhere; unchanged with this branch).
- `npx eslint` on the four source files - clean. (Whole-repo `npm run lint` reports ~1750
  pre-existing problems on `master`; test files are excluded from `tsconfig.json` and were
  prettier-formatted instead.)
- Not wired into `App.tsx` yet - adding the layout route is a routing change outside these
  issues.

## Related issues

Closes #1412
Closes #1413
Closes #1414
Closes #1415

## Checklist

- [x] Commit messages follow Conventional Commits style
- [x] No panics introduced (errors are propagated, not panicked)
