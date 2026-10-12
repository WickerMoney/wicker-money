/**
 * A manifest an operator placed in `PLUGIN_MANIFEST_DIR`, before validation.
 *
 * Kept as the raw parsed JSON: it is untrusted input, and `PluginService`
 * validates it with `parseManifest` like every other manifest, so a failure
 * shows up in the owner's plugin list with its reason instead of vanishing.
 */
export interface ExternalPlugin {
  /** The file it was read from, relative to the directory, for messages. */
  readonly source: string
  /** The parsed JSON. Its `id` is known to be a well-formed plugin id; nothing else is. */
  readonly manifest: unknown
}
