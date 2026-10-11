import type { FrameKind } from '@wickermoney/plugin-sdk/isolated'

/** What the host asked this frame to mount, read from the URL fragment. */
export interface FrameParams {
  /** The plugin's manifest id. */
  readonly pluginId: string
  /** The remote entry URL, absolute. */
  readonly entry: string
  /** The exposed module key, for example `./TrendWidget`. */
  readonly module: string
  readonly kind: FrameKind
}

const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const MODULE_KEY = /^\.\/[A-Za-z0-9_-]+$/

/**
 * Reads and checks the frame's parameters.
 *
 * The fragment is written by the host, but anyone can open the frame URL
 * directly, so it is checked like any input: the id and module key must look
 * the way manifests require, and the entry must be an `http(s)` URL (so no
 * `javascript:` or `data:` URL can reach the module loader). Which origins the
 * entry may actually load from is not decided here: the frame document's CSP
 * allows scripts from the API's own origin and the operator's configured plugin
 * origins and nothing else.
 *
 * @param hash - `location.hash`.
 * @param base - The frame document's URL, to resolve a relative entry against.
 * @returns The parameters, or a message saying what is wrong.
 */
export function parseFrameFragment(hash: string, base: string): FrameParams | { readonly error: string } {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const pluginId = params.get('id') ?? ''
  const module = params.get('module') ?? ''
  const kind = params.get('kind')
  const rawEntry = params.get('entry') ?? ''
  if (!PLUGIN_ID.test(pluginId) || pluginId.length > 100) return { error: 'The plugin id is missing or invalid.' }
  if (!MODULE_KEY.test(module)) return { error: 'The plugin module is missing or invalid.' }
  if (kind !== 'widget' && kind !== 'page') return { error: 'The frame kind must be widget or page.' }
  let entry: URL
  try { entry = new URL(rawEntry, base) } catch { return { error: 'The plugin entry is not a URL.' } }
  if (entry.protocol !== 'https:' && entry.protocol !== 'http:') return { error: 'The plugin entry must be an http(s) URL.' }
  return { pluginId, entry: entry.href, module, kind }
}
