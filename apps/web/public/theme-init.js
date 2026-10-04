/* global document, localStorage */
// Applies the remembered theme before first paint; otherwise a dark-mode user
// gets a white flash while the bundle loads. index.html loads this as a plain,
// render-blocking <script src> in <head>, so it runs before the body paints.
//
// It lives in its own file rather than inline in index.html because the API
// serves the app with `script-src 'self'`, which blocks inline scripts.
//
// The key must match THEME_STORAGE_KEY in src/theme/themeStorage.ts (a test
// checks). Storage can throw (private windows, blocked cookies), hence the
// try/catch; the app applies the theme again once the bundle loads.
try {
  var theme = localStorage.getItem('wickermoney.theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch {
  // Storage is blocked; the app falls back to the system theme once it loads.
}
