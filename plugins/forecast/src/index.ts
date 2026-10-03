/**
 * Build entry.
 *
 * Module Federation serves the page through `remoteEntry.js` via `exposes`;
 * this file exists so Vite has a root input, and doubles as the import path for
 * anything consuming the plugin directly (tests, or a future static bundling of
 * bundled plugins).
 */
export { default as ForecastPage } from './ForecastPage.js'
