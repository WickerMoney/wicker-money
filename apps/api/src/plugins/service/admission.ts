import { checkRemoteEntryIntegrity, type PluginManifest } from '@wickermoney/plugin-sdk'
import { isHostServedEntry } from '../firstPartyEntry.js'

/**
 * Where a manifest came from.
 *
 * - `bundled`: listed in the host's own code (`BUNDLED_PLUGINS`), shipped in the image and reviewed with it.
 * - `external`: read from the operator's manifest directory. Nothing the manifest says can make it `bundled`.
 */
export type PluginSource = 'bundled' | 'external'

/**
 * The rule that a plugin the image did not ship gets no server half.
 *
 * `contributes.endpoints` and `contributes.exporters` mean the API would run the
 * plugin's own code, in its own process, with its database role. Only code that
 * ships in the image and is reviewed with it may do that (ADR 0007), so an
 * external manifest that asks for either is refused outright rather than
 * having the flag ignored: a flag that reads true and does nothing misleads the
 * person who enabled the plugin.
 *
 * The routes themselves are mounted for a fixed list of bundled ids
 * (`registerBundledPluginServers`), so this is the explicit, tested rule behind
 * what would otherwise be an accident of how the registry is built.
 *
 * @param manifest - A validated manifest.
 * @param source - Where it came from.
 * @returns A message saying why the plugin cannot load, or `undefined`.
 */
export function serverCodeRefusal(manifest: PluginManifest, source: PluginSource): string | undefined {
  if (source === 'bundled') return undefined
  if (manifest.contributes.endpoints) {
    return "asks for server endpoints (contributes.endpoints), which only a plugin shipped in the image may have: a third-party plugin has no server half"
  }
  if (manifest.contributes.exporters) {
    return "asks for a data exporter (contributes.exporters), which only a plugin shipped in the image may have: a third-party plugin has no server half"
  }
  return undefined
}

/**
 * The rule that script the image did not ship loads only against a pin.
 *
 * An external plugin always needs one, and so does any entry on another origin.
 * A bundled plugin served from the image does not: its files are the image's.
 *
 * @param manifest - A validated manifest.
 * @param source - Where it came from.
 * @returns A message saying why the pin is missing or unusable, or `undefined`.
 */
export function pinRefusal(manifest: PluginManifest, source: PluginSource): string | undefined {
  if (source === 'bundled' && isHostServedEntry(manifest.remoteEntry)) return undefined
  return checkRemoteEntryIntegrity(manifest.remoteEntry, manifest.integrity)
}
