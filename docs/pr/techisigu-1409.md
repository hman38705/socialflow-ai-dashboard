## Title

FE-030: StatBadge and generic Badge

## Body

Two new design-system primitives (the deleted `src/components/ui/StatBadge.tsx` is
replaced with the simpler signed-`delta` API the issue specifies). No existing files
change.

**`src/components/ui/StatBadge.tsx` (new)**

- `<StatBadge delta={number} precision?={1} />`. A positive `delta` renders an `ArrowUp`
  glyph plus `+X%` in `text-trend-up`; a negative `delta` renders `ArrowDown` plus `-X%`
  in `text-trend-down`; `0` renders `0%` in `text-gray-subtext` with no arrow.
- Colour is never the only signal: the arrow is one channel, and a visually-hidden
  `<span class="sr-only">` announces "up 12.5 percent" / "down 3.2 percent" / "no change".
- `precision` controls the displayed decimals; a trailing `.0` is trimmed.

**`src/components/ui/Badge.tsx` (new)**

- `<Badge variant="neutral | info | success | warning | danger" dot?>` - a pill `span`
  whose variant selects a background/text/border token set. `dot` adds a decorative
  (`aria-hidden`) leading status dot.

## Verification

- `npx vitest run src/components/ui/StatBadge.test.tsx src/components/ui/Badge.test.tsx` -
  7 passed (sign -> token including zero, arrow presence, accessible text, precision;
  per-variant token, dot conditional and decorative).
- `npx tsc --noEmit` - the two new files add no errors (`master` already has 28 pre-existing
  `tsc` errors elsewhere; unchanged with this branch).
- `npx eslint` on both source files - clean.

## Related issues

Closes #1409

## Checklist

- [x] Commit messages follow Conventional Commits style
- [x] No panics introduced (errors are propagated, not panicked)
