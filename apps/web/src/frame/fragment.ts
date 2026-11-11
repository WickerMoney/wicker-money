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
  /** The manifest's integrity pin, file path to SRI value, when the host sent one. */
  readonly integrity?: Readonly<Record<string, string>>
}

/**
 * Checks a pin with the SDK's own rules, loading them only now.
 *
 * `parseIntegrity` lives in the SDK root, which carries the Zod manifest schemas
 * (about 85 kB). Only a plugin the host did not ship has a pin, so the frame of a
 * bundled plugin never needs them and must not download them: this is the one
 * place the frame reaches the root, and it does so with a dynamic `import()`.
 * zod is configured first (see `configureZod.ts`), because it probes `new Function`
 * when the first schema is built, and that is also what a plugin that brings its
 * own zod relies on to find the setting.
 */
async function checkPin(
  value: unknown,
): Promise<{ readonly integrity: Readonly<Record<string, string>> } | { readonly error: string }> {
  await import('../configureZod.js')
  const { parseIntegrity } = await import('@wickermoney/plugin-sdk')
  return parseIntegrity(value)
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
 * An `integrity` value is the manifest's pin as JSON and is checked with the SDK's
 * own rules, which are loaded on demand (see `checkPin`), so this is asynchronous.
 * Whether a pin is required is decided when the module loads.
 *
 * @param hash - `location.hash`.
 * @param base - The frame document's URL, to resolve a relative entry against.
 * @returns The parameters, or a message saying what is wrong.
 */
export async function parseFrameFragment(hash: string, base: string): Promise<FrameParams | { readonly error: string }> {
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
  const rawIntegrity = params.get('integrity')
  if (rawIntegrity === null) return { pluginId, entry: entry.href, module, kind }
  let decoded: unknown
  try { decoded = JSON.parse(rawIntegrity) } catch { return { error: 'The integrity pin is not valid JSON.' } }
  const pin = await checkPin(decoded)
  if ('error' in pin) return { error: `The integrity pin is not valid: ${pin.error}` }
  return { pluginId, entry: entry.href, module, kind, integrity: pin.integrity }
}
