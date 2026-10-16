import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { IN_REALM_PLUGIN_IDS } from './bundled.js'
import { isHostServedEntry } from './firstPartyEntry.js'

/**
 * Where a plugin's UI runs.
 *
 * - `in-realm`: inside the app's own page, through Module Federation, with the
 *   host's realm and origin. Only a bundled plugin the host lists can.
 * - `isolated`: in a sandboxed frame with an opaque origin, behind the broker.
 */
export type PluginRuntime = 'in-realm' | 'isolated'

/**
 * Decides where a plugin's UI runs. The host decides; a manifest never does.
 *
 * Isolated is the default and the only answer for anything the image did not
 * ship, and for any entry the host does not serve itself. In-realm needs all of:
 * the plugin is bundled, its `remoteEntry` is a path this host serves, its id is
 * in {@link IN_REALM_PLUGIN_IDS}, and its manifest does not say `isolated: true`.
 * The flag can only move a plugin towards isolation, so a third-party manifest
 * that lists itself as anything cannot reach in-realm, and a bundled plugin
 * that has been ported leaves it by setting the flag.
 *
 * The entry rule is the origin gate: script from another origin has no in-realm
 * path, whoever listed it and whatever `PLUGIN_REMOTE_ORIGINS` holds. Today no
 * bundled manifest has a remote entry, so the rule only matters if one is ever
 * crafted or mistyped, which is what it is for.
 *
 * @param manifest - The validated manifest.
 * @param bundled - Whether the plugin ships in the image, from the registry row.
 * @returns The runtime the web app must use for the plugin's widgets and pages.
 * @example
 * pluginRuntimeFor(manifest, false) // 'isolated', whatever the manifest says
 */
export function pluginRuntimeFor(manifest: PluginManifest, bundled: boolean): PluginRuntime {
  if (!bundled) return 'isolated'
  if (!isHostServedEntry(manifest.remoteEntry)) return 'isolated'
  if (manifest.isolated === true) return 'isolated'
  return IN_REALM_PLUGIN_IDS.has(manifest.id) ? 'in-realm' : 'isolated'
}
