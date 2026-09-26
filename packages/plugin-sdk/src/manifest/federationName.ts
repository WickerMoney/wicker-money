/**
 * Derives the Module Federation container name for a plugin id.
 *
 * Federation names must be valid JS identifiers, but plugin ids are
 * reverse-domain. Both the host and the plugin's build derive the name with
 * this function rather than writing it twice: a mismatch fails at runtime with
 * an opaque "remote not found".
 *
 * @param pluginId - The plugin's manifest id, e.g. `wickermoney.insights`.
 * @returns The id with every character outside `[a-zA-Z0-9_]` replaced by `_`.
 */
export function federationName(pluginId: string): string {
  return pluginId.replace(/[^a-zA-Z0-9_]/g, '_')
}
