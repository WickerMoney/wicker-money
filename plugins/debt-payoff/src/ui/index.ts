/**
 * Build entry for the Module Federation remote.
 *
 * Exists so Vite has a root input; the host loads each module through
 * `remoteEntry.js` using the names the manifest exposes.
 */
export { default as DebtPayoffPage } from './DebtPayoffPage.js'
