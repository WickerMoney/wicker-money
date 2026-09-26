import type { PluginManifest } from './PluginManifest.js'

/**
 * Outcome of validating an untrusted manifest.
 *
 * Exactly one field is set: `manifest` on success, `error` on failure.
 */
export interface ManifestParseResult {
  /** The validated manifest. Absent when validation failed. */
  readonly manifest?: PluginManifest
  /** Why validation failed, as a single readable message. Absent on success. */
  readonly error?: string
}
