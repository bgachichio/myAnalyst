/**
 * design.md §12.1. Applies the saved theme and font scale before anything
 * paints, so the wrong one never flashes.
 *
 * A separate file rather than an inline script, because the site is served
 * under `script-src 'self'` with no unsafe-inline and no hash: inline, the
 * browser refuses to run it, and the app silently loses its theme and its
 * font scale on every load. It is fetched from the same origin and blocks
 * paint exactly as the inline version did.
 */
(function () {
  try {
    var t = localStorage.getItem('ui.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    var f = localStorage.getItem('ui.fontScale') || 'default';
    document.documentElement.dataset.fontScale = f;
  } catch (e) {}
})();
