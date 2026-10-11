import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { IN_REALM_PLUGIN_IDS } from './bundled.js'

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
 * ship. In-realm needs all three of: the plugin is bundled, its id is in
 * {@link IN_REALM_PLUGIN_IDS}, and its manifest does not say `isolated: true`.
 * The flag can only move a plugin towards isolation, so a third-party manifest
 * that lists itself as anything cannot reach in-realm, and a bundled plugin
 * that has been ported leaves it by setting the flag.
 *
 * @param manifest - The validated manifest.
 * @param bundled - Whether the plugin ships in the image, from the registry row.
 * @returns The runtime the web app must use for the plugin's widgets and pages.
 * @example
 * pluginRuntimeFor(manifest, false) // 'isolated', whatever the manifest says
 */
export function pluginRuntimeFor(manifest: PluginManifest, bundled: boolean): PluginRuntime {
  if (!bundled) return 'isolated'
  if (manifest.isolated === true) return 'isolated'
  return IN_REALM_PLUGIN_IDS.has(manifest.id) ? 'in-realm' : 'isolated'
}
