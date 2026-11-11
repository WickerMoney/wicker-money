/**
 * How the frame names and loads a plugin's remote.
 *
 * These two are the SDK's `REMOTE_ENTRY_TYPE` and `federationName`, copied here
 * because the SDK exports them only from its root, and the root carries the Zod
 * manifest schemas (about 85 kB) that a frame does not otherwise need. A test
 * (`federation.test.ts`) keeps the copies in step with the SDK. If the SDK ever
 * re-exports them from `@wickermoney/plugin-sdk/isolated`, import them from there
 * and delete this file.
 */

/** How a remote entry is loaded: as an ES module. Same value as the SDK's `REMOTE_ENTRY_TYPE`. */
export const REMOTE_ENTRY_TYPE = 'module' as const

/**
 * Derives the Module Federation container name for a plugin id: every character
 * outside `[a-zA-Z0-9_]` becomes `_`. Same rule as the SDK's `federationName`.
 *
 * @param pluginId - The plugin's manifest id, e.g. `wickermoney.insights`.
 * @returns The container name.
 */
export function federationName(pluginId: string): string {
  return pluginId.replace(/[^a-zA-Z0-9_]/g, '_')
}
