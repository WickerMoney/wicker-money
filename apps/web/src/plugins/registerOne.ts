import { registerRemotes } from '@module-federation/runtime'
import { REMOTE_ENTRY_TYPE, federationName, parseManifest, type PluginManifest } from '@wickermoney/plugin-sdk'
import type { PluginLoadFailure } from './PluginLoadFailure.js'

/**
 * Validates one manifest as the server sent it and registers its remote.
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
  try {
    registerRemotes([
      {
        name: federationName(manifest.id),
        entry: manifest.remoteEntry,
        // Plugin entries are ES modules. Without this the runtime injects a
        // classic <script> and every widget fails at mount.
        type: REMOTE_ENTRY_TYPE,
      },
    ])
    return manifest
  } catch (err) {
    failures.push({
      pluginId: manifest.id,
      reason: err instanceof Error ? err.message : 'could not register remote',
    })
    return undefined
  }
}
