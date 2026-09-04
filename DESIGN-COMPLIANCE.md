# Design compliance — myAnalyst

`design.md` §17, printed before shipping. Verified on a real headless Chromium
at 390×844 in both themes, under the **same content-security-policy Caddy
serves**, not by reading the code. The screens are Analyse, Private, Watchlist,
Compare and Settings.

```
DESIGN COMPLIANCE - myAnalyst, 4 September 2026

SUBSTRATE
[x] shadcn/ui patterns + Tailwind only. No MUI, chart.js, bootstrap, antd or
    chakra in package.json.
[x] Zero hardcoded hex values in src/components, src/screens or src/hooks.
    Verified: grep for #rgb/#rrggbb returns nothing.
[x] Zero raw Tailwind palette classes (gray/slate/zinc/red/blue/...).
    Verified: grep returns nothing.

SURFACE
[x] Every colour is an --md-* role token paired with its on- partner. The
    error-container pair was added when the reader needed it, rather than
    reaching for a raw red.
[x] Green on action and active state only: primary button, active nav, active
    segment, chart series, slider track and thumb.
[x] Elevation from the six-level set; dark mode drops cards to flat.
[x] Inter for UI and body; Courier Prime bound to .display-*/.headline-* only.

LAYOUT
[x] One column on mobile, always. Gutters and gaps from the §8.2 scale.
[x] No page scrolls sideways at 390px. Asserted per screen, including the
    private-deal screen with its five input cards.
[x] Prose capped at 68ch everywhere it appears.

CONTROLS
[x] Every interactive control clears the 44px touch floor. Asserted in the
    browser across both themes; screen-reader-only controls are excluded
    explicitly, because measuring a clipped element measures the clip.
[x] Ripple on every button and nav item, via one shared hook.
[x] Focus visible on every control, 2px, offset, primary.

CHARTS (§11.1, the four-part contract)
[x] Title, unit stated once, direct label on the point that matters, and a
    one-sentence summary that doubles as the accessible description.
[x] Bars start at zero. Single series, so --md-primary.
[x] Every chart carries a screen-reader table of the same numbers.
[x] A trend with one period draws nothing and says why, rather than a dot.

NON-NEGOTIABLE DEFAULTS (§12)
[x] Lighting: Auto / Light / Dark, defaulting to the device, persisted.
[x] Font size: four steps, persisted.
[x] Settings one tap away: gear in the top bar on desktop, last nav item on
    mobile. The sheet scrolls, since it now carries the model dials too.
[x] No flash of the wrong theme. The script that applies it runs before paint.
    It is a FILE, not inline: under `script-src 'self'` the browser refuses
    inline script, so in production the saved theme and font scale would have
    been silently dropped on every load. Caught by serving the real policy in
    the browser check.

ACCESSIBILITY (§13)
[x] Skip link to main content.
[x] Every icon-only control has an aria-label.
[x] Charts have role="img" and an accessible description.
[x] Nav uses aria-current="page".
[x] No console errors and no policy refusals, in either theme.
```

## What verification found, and what was done

Three defects on the shell, all found by looking rather than by reading:
page-wide horizontal overflow from a screen-reader-only table, a duplicated
settings entry point on mobile, and a settings sheet that could not be opened.

Four more once the check drove the built app under the production policy:

1. **The theme script was inline** and would have been refused by the
   content-security-policy in production — the saved theme and font scale lost
   on every load, silently, with nothing failing. It is a file now.
2. **A finding rendered twice** on the private-deal screen, hero and card.
3. **The settings sheet could not scroll** once the model dials were added to
   it, so the lower controls were unreachable on a phone.
4. **No favicon**, so every load logged a 404 and the tab showed a default
   globe.

The check that found the first of those was itself decoration until the console
listener came back: a policy refusal is reported to the console and nowhere
else, so a check listening only for thrown errors cannot see the policy working
or failing.
