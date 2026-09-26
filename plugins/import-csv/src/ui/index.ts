/**
 * Build entry for the Module Federation remote.
 *
 * Exists so Vite has a root input; the host loads the page through
 * `remoteEntry.js` using the manifest's exposed name.
 */
export { default as ImportPage } from './ImportPage.js'
