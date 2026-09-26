/**
 * `Cache-Control` for a file served from the web app's build output.
 *
 * Only the host's own `assets/` directory is immutable: Vite puts a content hash
 * in every name there, so a changed file always has a new URL. Everything else
 * — `index.html`, the host's `remoteEntry-*.js`, and each plugin's unhashed
 * `plugins/<name>/remoteEntry.js` — is revalidated on every load, otherwise a
 * browser could keep running yesterday's plugin after an upgrade.
 *
 * @param relativePath - Path of the file relative to the build output, with `/` separators.
 * @returns The header value.
 */
export function cacheControlFor(relativePath: string): string {
  return relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
}
