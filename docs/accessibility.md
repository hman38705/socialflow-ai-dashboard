# Accessibility Audit — FE-122

Status of the Phase 10 a11y pass. The UI layer is mid-rebuild (see `chore/frontend-reset`), so
route- and flow-level checks below are written as the checklist to run against each page/flow as
it lands, with the token/contrast work done now since it doesn't depend on components existing.

## 1. Color contrast — token pairs

Measured with WCAG 2.1 relative-luminance contrast against the aurora dark palette in
`tailwind.config.js`. Threshold: **4.5:1** for normal text, **3:1** for large text (≥18pt / 14pt
bold) and UI components.

| Foreground token | Background | Ratio | Normal text (4.5:1) | Large text / UI (3:1) |
|---|---|---|---|---|
| `gray-subtext` (#94a3b8) | `dark-bg` (#070A14) | 7.71:1 | ✅ | ✅ |
| `gray-subtext` (#94a3b8) | `dark-surface` (~#0F1322 effective) | 7.19:1 | ✅ | ✅ |
| white text | `dark-bg` | 19.76:1 | ✅ | ✅ |
| white text | `dark-surface` | 18.43:1 | ✅ | ✅ |
| `primary-blue` (#4f83ff) | `dark-bg` | 5.67:1 | ✅ | ✅ |
| `primary-teal` (#22d3ee) | `dark-bg` | 10.94:1 | ✅ | ✅ |
| `primary-purple` (#8b5cf6) | `dark-bg` | 4.67:1 | ✅ (near floor) | ✅ |
| `primary-rose` (#f43f5e) | `dark-bg` | 5.38:1 | ✅ | ✅ |

**Result:** every token pair currently defined clears AA for normal text; no token values needed
to change. `primary-purple` is the closest to the floor (4.67:1) — flagged for follow-up if it's
ever placed on a lighter surface or used at sub-14px sizes; avoid pairing it with anything other
than `dark-bg`/`dark-elev`/`dark-surface` for text. Re-run this table (`node` snippet in git
history of this file, or recompute via any WCAG contrast calculator) whenever a color in the
`colors` block of `tailwind.config.js` changes, and update it here before merging that change.

## 2. Automated axe checks

`src/test/a11y.ts` exports `expectNoA11yViolations(container)`, a thin wrapper around
`axe-core` that page-level component tests call after render:

```ts
import { expectNoA11yViolations } from '@/test/a11y';

it('has no serious/critical a11y violations', async () => {
  const { container } = render(<AnalyticsPage />);
  await expectNoA11yViolations(container);
});
```

It fails the test on any `serious` or `critical` violation (impact levels below that are logged
as warnings, not failures, to keep the gate meaningful). Wire one call per page-level component as
pages are rebuilt — none exist yet in this branch.

## 3. Keyboard walkthrough

Checklist per route, to fill in as routes return:

- [ ] Every interactive element reachable via Tab in visual/logical order
- [ ] No keyboard trap (Escape / Tab always moves focus onward)
- [ ] Visible focus ring on every focusable element (don't rely on browser default alone against
      the dark background — verify contrast of the focus ring itself, 3:1 minimum against
      `dark-bg`)
- [ ] Modal/dialog focus is trapped while open and restored to the trigger on close
- [ ] Skip-to-content link present on pages with a persistent nav

Routes to walk once rebuilt: login, compose, schedule, analytics, settings.

## 4. Text alternatives / color-only meaning

- [ ] Every `<img>` has meaningful `alt` (empty `alt=""` only for purely decorative images)
- [ ] Icon-only buttons have `aria-label`
- [ ] Chart components (Recharts) expose a text/table equivalent or `aria-label` summarizing the
      data — trend arrows/colors are paired with a text label or icon, never color alone
- [ ] Status/trend indicators (`trend-up` / `trend-down`) always ship with an icon or word, not
      just a color swap

## 5. Screen-reader smoke test

Manual pass with VoiceOver (macOS) or NVDA (Windows) once each flow exists:

- [ ] Sign in
- [ ] Compose a post
- [ ] Schedule a post
- [ ] View analytics

Record pass/fail and any fixes here per flow when run.
