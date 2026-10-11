import type { FrameKind } from '@wickermoney/plugin-sdk/isolated'

/** Where the API serves the sandboxed frame document. Keep in step with `PLUGIN_FRAME_PATH` in the API. */
export const PLUGIN_FRAME_PATH = '/plugin-frame'

/** What the frame bootstrap needs to find and mount one plugin module. */
export interface FrameTarget {
  /** The plugin's manifest id. */
  readonly pluginId: string
  /** The plugin's remote entry, from its manifest. */
  readonly remoteEntry: string
  /** The exposed module key, such as `./TrendWidget`. */
  readonly module: string
  readonly kind: FrameKind
}

/**
 * The URL of the frame document for one plugin module.
 *
 * The target travels in the fragment, not the query: a fragment is never sent
 * to the server, so the frame document stays one cacheable file for every
 * plugin, and the server sees no plugin ids it has to trust.
 *
 * @param target - The module to mount.
 * @returns A path with a fragment, relative to the host's origin.
 */
export function frameUrl(target: FrameTarget): string {
  const params = new URLSearchParams({
    id: target.pluginId, entry: target.remoteEntry, module: target.module, kind: target.kind,
  })
  return `${PLUGIN_FRAME_PATH}#${params.toString()}`
}
