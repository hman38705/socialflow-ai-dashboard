# Performance Budget — FE-123

## Budget

- **Initial JS (entry + its synchronously-imported chunks), gzipped: ≤ 250KB.** Enforced in CI by
  `scripts/check-bundle-budget.mjs` against the Vite build's manifest — the build step fails
  (non-zero exit) when exceeded.
- Anything not needed for first paint/interaction must be behind a dynamic `import()` so it lands
  in its own chunk, outside the budget.

## Code splitting

- Route-level: each page is loaded via `React.lazy(() => import('./pages/X'))`. There are no page
  components in this branch yet (mid-rebuild); this is the pattern to use as they're added, and
  the budget check will start reporting real numbers once `src/pages/**` exists and is wired into
  routing.
- **Always dynamically imported, never in the entry chunk:**
  - `pptxgenjs` — imported only at the point a user triggers an export, e.g.
    `const { default: pptxgen } = await import('pptxgenjs')`.
  - `src/blockchain/**` (Stellar/Soroban) — imported only when a wallet/blockchain action is
    invoked, e.g. `const { connectWallet } = await import('@/blockchain/wallet')`.

## Manual vendor chunking

`vite.config.ts` groups heavy, infrequently-changing vendor libraries into their own cacheable
chunks (`build.rollupOptions.output.manualChunks`):

- `vendor-charts` — `recharts` and its d3 sub-dependencies
- `vendor-motion` — `framer-motion`
- `vendor-realtime` — `socket.io-client`
- `vendor-storage` — `dexie`
- `vendor-blockchain` — `@stellar/stellar-sdk` (also excluded from the initial-JS budget check
  since it must never be eager — see "Always dynamically imported" above)

Splitting these out means a dependency bump to one doesn't invalidate the browser cache for the
others, and none of them inflate the entry chunk that the budget check measures.

## Bundle composition report

`vite build` runs with `rollup-plugin-visualizer` enabled, writing
`dist/bundle-report.html` (treemap of gzipped chunk sizes). The `frontend` CI workflow uploads it
as a build artifact on every run and links it from the job summary so it's easy to open from a PR.

## Fonts

`index.html` already sets `display=swap` on the Google Fonts `<link>` and has `preconnect` hints
for `fonts.googleapis.com` and `fonts.gstatic.com`. `tailwind.config.js`'s `fontFamily.sans` /
`fontFamily.mono` stacks list `system-ui` / `ui-monospace` (native OS fonts) before the generic
fallback, so text renders immediately in a system font and reflows to Fira Sans/Fira Code once the
webfont arrives — no invisible-text flash.

## CI wiring

`.github/workflows/frontend.yml`:
1. `npm ci`
2. `npm run build` (produces `dist/` + `dist/bundle-report.html`)
3. `node scripts/check-bundle-budget.mjs` — fails the job if initial JS exceeds 250KB gzipped
4. Uploads `dist/bundle-report.html` as a build artifact
