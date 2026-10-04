import { registerRemotes } from '@module-federation/runtime'
import { REMOTE_ENTRY_TYPE, federationName, parseManifest, type PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginLoadFailure } from './PluginLoadFailure.js'

/**
 * Remote names already handed to the federation runtime in this page.
 *
 * The registry is fetched again whenever a plugin is switched on or off, so
 * the same manifest comes through here many times. A remote is registered
 * once: the runtime keeps a loaded remote's modules in memory for the life of
 * the page, and a plugin that is switched off and on again reuses them rather
 * than registering (and possibly evaluating) its entry a second time.
 */
const registered = new Set<string>()

/**
 * Validates one manifest as the server sent it and registers its remote,
 * unless a remote of that name is already registered.
 *
 * @param raw - One entry of the server's plugin list, not yet trusted.
 * @param failures - Receives a failure entry when the manifest is invalid or the remote cannot be registered.
 * @returns The manifest when it registered, otherwise `undefined`.
 */
export function registerOne(raw: unknown, failures: PluginLoadFailure[]): PluginManifest | undefined {
  const { manifest, error } = parseManifest(raw)
  if (manifest === undefined) {
    const id = typeof raw === 'object' && raw !== null && 'id' in raw ? String(raw.id) : 'unknown'
    failures.push({ pluginId: id, reason: error ?? 'invalid manifest' })
    return undefined
  }
  const name = federationName(manifest.id)
  if (registered.has(name)) return manifest
  try {
    registerRemotes([
      {
        name,
        entry: manifest.remoteEntry,
        // Plugin entries are ES modules. Without this the runtime injects a
        // classic <script> and every widget fails at mount.
        type: REMOTE_ENTRY_TYPE,
      },
    ])
    registered.add(name)
    return manifest
  } catch (err) {
    failures.push({
      pluginId: manifest.id,
      reason: err instanceof Error ? err.message : 'could not register remote',
    })
    return undefined
  }
}
