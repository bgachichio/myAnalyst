# Design compliance — the PWA shell

`design.md` §17, printed before shipping. Verified on a real headless Chromium
at 390×900 and 1280×900, in both themes and at every font scale, not by reading
the code.

```
DESIGN COMPLIANCE - myAnalyst shell (Analyse, Watchlist, Compare, Journal, Settings)

SUBSTRATE
[x] shadcn/ui patterns + Tailwind only. No MUI, no other UI library installed.
[x] Zero hardcoded hex values in component files - all colour via --md-* tokens.
[x] Zero raw Tailwind palette classes (gray/slate/zinc).

SURFACE
[x] Every colour is an --md-* role token, paired with its on- partner.
[x] Green appears on action and active state only: primary button, active nav,
    active segment, chart series.
[x] Elevation from the six-level set; dark mode drops cards to flat.
[x] Inter for UI and body. Courier Prime for display-*/headline-* only.
[x] Weights 400/500/600 on Inter, 400 on mono. Tracking 0em on every mono token.
[x] No px font sizes. Every size in rem, so one variable moves the system.
[x] Ripple + state layer on every button, suppressed under reduced motion.

STRUCTURE
[x] Density comfortable. Surface tint carries separation, not borders.
[x] Cards at 20px radius. Primary and tonal buttons are pills.
[x] Spacing values from the approved scale only.
[x] Screen gutter 16/24/32, card padding 20/24, section gap 40.
[x] No element carries both a border and a shadow.
[x] Single column on mobile. Touch targets >= 44px; primary action 48px.

CHARTS
[x] Horizontal gridlines only. No axis lines, tick marks or border.
[x] Title, unit, direct label on the key point, one-sentence summary.
[x] Single series, so --md-primary. Bars start at zero.
[x] Hidden data table for screen readers.

NON-NEGOTIABLES
[x] Auto/Light/Dark toggle, default Auto, persisted to ui.theme.
[x] Font size toggle, four steps, persisted to ui.fontScale.
[x] No-FOUC script in <head>, before any stylesheet.
[x] Tested at xlarge scale and in dark mode - verified, screenshots taken.
[x] PWA installable, offline-capable, mobile as the primary target.

MINIMALIST AUDIT
[x] Deletion Test run. Removed: dashboard, hero banner, stat-tile row, chart
    legend, icon-only navigation, and the second settings entry point.
[x] Every remaining element answers: necessary / must look this way / needed now.

ACCESSIBILITY
[x] Contrast verified in both modes. Keyboard path complete. Focus ring visible.
[x] Skip-to-content link. Every icon-only button carries an aria-label.
[x] Chart exposed as role="img" with a description, plus an sr-only data table.
[x] Reduced motion respected - the ripple returns early, transitions collapse.
```

## What the verification actually found

Three defects, each found by looking rather than by reading:

1. **Horizontal page overflow in every state.** The chart's screen-reader data
   table carried `sr-only`, but a table's min-content width beats `width: 1px`,
   so it escaped its own clip and pushed the page to 503px on a 390px screen.
   Fixed by moving the clip to a wrapper, where `overflow: hidden` can work.
2. **Two settings entry points on mobile.** The top-bar gear used
   `hidden sm:grid` against a base `display` utility — a specificity tie decided
   by stylesheet order, not by intent. Fixed by hiding a wrapper instead.
3. **The settings sheet could not be opened on mobile at all.** The nav handler
   returned `undefined` for the settings item, swallowing the call that opens
   it. Fixed, then proved: the sheet opens, both toggles apply live, both
   persist, and both survive a reload with no flash of the wrong theme.

## Deliberate deviation

None. Where `design.md` supplies a file — `globals.css` §15, `useRipple` §16.1,
`useAppearance` §16.2 — it was used as written rather than reinvented, with
types added and storage access wrapped so a private window cannot throw.
