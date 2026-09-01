## Title

FE-025-028: EmptyState, DataTable, Pagination, Tabs

## Body

Four Phase 3 list/table primitives. Each is a new file with a co-located test; nothing
existing is modified.

**FE-025 - `EmptyState` (`src/components/ui/EmptyState.tsx`, new)**

- `{ icon: LucideIcon, title, description?, action?: { label, onClick }, variant:
  'empty' | 'error' | 'no-results' }`.
- `error` renders as `role="alert"` with the rose token on the border/icon and a
  rose-styled action (used for "Retry"); the other variants render as `role="status"`.
- Tests: the action fires; the error variant renders its retry button; non-error variants
  are a status region.

**FE-026 - `DataTable` (`src/components/ui/DataTable.tsx`, new)**

- `DataTable<T>({ columns, rows, getRowId, selectable?, selectedIds?, onSelectionChange?,
  loading?, loadingRows?, sort?, onSortChange?, emptyState? })`.
- `Column<T>`: `key, header, render?, sortable?, align?, width?, numeric?`.
- Semantic `<table>`; sortable headers are `<button>`s that carry `aria-sort`
  (`none` -> `ascending` -> `descending` -> `none`), controlled via `sort`/`onSortChange`
  or an internal fallback.
- `<thead>` is `sticky top-0` inside an `overflow-x-auto` wrapper, so wide tables scroll the
  container, never the page.
- Optional selection: a header checkbox whose `.indeterminate` is set imperatively when some
  but not all rows are selected.
- `loading` renders `loadingRows` skeleton `<tr>`s with a pulse bar in every column
  (selection column included). `Skeleton` from FE-023 is not on `master` yet, so the bar is
  inline; swap it for `<Skeleton>` once that lands.
- Empty (no rows, not loading) renders the `emptyState` node (an `<EmptyState />`).
- `numeric` columns render cells with `font-mono tabular-nums`.
- Tests: sort cycle updates `aria-sort` and emits the right `SortState`; select-all
  indeterminate vs checked; skeleton row and cell counts.

**FE-027 - `Pagination` (`src/components/ui/Pagination.tsx`, new)**

- `{ page, pageSize, total, onPageChange, onPageSizeChange?, pageSizeOptions=[10,25,50,100] }`.
  (`pageSize` is the design-spec name; the server `PagedResponse` calls the field `limit`.)
- `pageCount = ceil(total / pageSize)`; the component renders `null` when `pageCount <= 1`.
- `<nav aria-label="Pagination">` with first/prev/next/last (disabled at the bounds) and a
  truncated page list: always page 1 and the last page, plus the current page and its
  neighbours, with at most one leading and one trailing ellipsis. The current page is
  `aria-current="page"`.
- The page-size `<select>` calls `onPageSizeChange` and resets to page 1.
- `pageTokens(current, pageCount)` is exported and unit-tested at the page 1 / middle / last
  boundaries; a separate test covers the page-size reset.

**FE-028 - `Tabs` (`src/components/ui/Tabs.tsx`, new)**

- `{ tabs: { id, label, content }[], defaultTabId?, urlParam? }`.
- `role="tablist" / "tab" / "tabpanel"` with matching `aria-controls` / `aria-labelledby`
  and ids.
- Roving tabindex: the active tab is `tabIndex={0}`, the rest `-1`. ArrowLeft/ArrowRight
  wrap, Home/End jump. Activation is **manual** - moving focus does not switch panels; only
  a click or Enter/Space on the focused tab does.
- `urlParam` mirrors the active tab id into that `useSearchParams` key (`replace: true`) and
  is read back on mount.
- The active-tab underline is a framer-motion `motion.div` with a shared `layoutId`.
- Only the active panel is mounted.
- Tests: single panel in the DOM; arrow keys move focus without activating; Enter activates;
  Home/End; `urlParam` write and initial read.

## Verification

- `npx vitest run src/components/ui` - 19 passed across 4 files.
- `npx tsc --noEmit` - the four new source files add no errors (`master` already has 28
  pre-existing `tsc` errors elsewhere; unchanged with this branch).
- `npx eslint` on the four source files - clean. (Whole-repo `npm run lint` reports ~1750
  pre-existing problems on `master`; test files are excluded from `tsconfig.json` and were
  prettier-formatted instead.)

## Related issues

Closes #1404
Closes #1405
Closes #1406
Closes #1407

## Checklist

- [x] Commit messages follow Conventional Commits style
- [x] No panics introduced (errors are propagated, not panicked)
