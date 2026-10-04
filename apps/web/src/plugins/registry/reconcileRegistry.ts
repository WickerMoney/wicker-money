import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginRegistry } from '../PluginRegistry.js'

/**
 * Merges a freshly fetched registry into the one on screen, keeping the old
 * object for every manifest that did not change.
 *
 * Plugin contexts, widget and page elements are all keyed on manifest
 * identity, so a refetch that hands back equal-but-new objects would make every
 * mounted widget rebuild its context and fetch its data again. Only plugins
 * that were actually added, removed or changed should move.
 *
 * @param previous - The registry currently rendered, or `null` before the first load.
 * @param next - The registry just fetched.
 * @returns `previous` itself when nothing changed, otherwise a registry that
 * reuses every unchanged manifest object from `previous`.
 */
export function reconcileRegistry(previous: PluginRegistry | null, next: PluginRegistry): PluginRegistry {
  if (previous === null) return next
  const before = new Map(previous.plugins.map((m) => [m.id, m]))
  const plugins: PluginManifest[] = next.plugins.map((m) => {
    const old = before.get(m.id)
    return old !== undefined && JSON.stringify(old) === JSON.stringify(m) ? old : m
  })
  const samePlugins =
    plugins.length === previous.plugins.length && plugins.every((m, i) => m === previous.plugins[i])
  const sameFailures = JSON.stringify(previous.failures) === JSON.stringify(next.failures)
  if (samePlugins && sameFailures) return previous
  return { plugins, failures: sameFailures ? previous.failures : next.failures }
}
