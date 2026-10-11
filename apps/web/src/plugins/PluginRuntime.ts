/**
 * Where a plugin's UI runs.
 *
 * `in-realm` plugins are loaded into the host page by Module Federation and
 * share its JavaScript realm, so they are trusted code. `isolated` plugins run
 * in a sandboxed iframe and reach the host only through the broker. The API
 * decides which (`pluginRuntimeFor`); the web app only obeys.
 */
export type PluginRuntime = 'in-realm' | 'isolated'

/**
 * Reads the runtime the API reported beside a manifest.
 *
 * Anything but an explicit `in-realm` is `isolated`. A server that does not
 * say, an old server, or a value this build does not know all fall to the
 * sandbox: the failure mode of a missing field must not be running the plugin
 * with page-level trust.
 *
 * @param raw - One entry of the server's plugin list.
 */
export function runtimeOf(raw: unknown): PluginRuntime {
  return typeof raw === 'object' && raw !== null && (raw as { runtime?: unknown }).runtime === 'in-realm'
    ? 'in-realm' : 'isolated'
}
