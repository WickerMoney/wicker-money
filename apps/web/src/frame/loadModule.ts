import { init, loadRemote, registerRemotes } from '@module-federation/runtime'
import { version as reactVersion } from 'react'
import { version as reactDomVersion } from 'react-dom'
import { REMOTE_ENTRY_TYPE, federationName } from '@wickermoney/plugin-sdk'
import type { ComponentType } from 'react'
import type { FrameParams } from './fragment.js'

/**
 * Loads the plugin's module with the frame's own federation runtime.
 *
 * This is a separate runtime from the host page's, in a separate realm: the
 * plugin gets the React that is bundled into the frame, and nothing the host
 * page holds. It mirrors the host loader on purpose (same singleton rules, same
 * `type: 'module'` remote) so a plugin built for one loads in the other.
 *
 * @param params - The validated frame parameters.
 * @returns The module's default export, a React component.
 * @throws {Error} When the remote cannot be loaded or exposes no such module.
 */
export async function loadPluginComponent(params: FrameParams): Promise<ComponentType<Record<string, unknown>>> {
  const name = federationName(params.pluginId)
  init({
    name: 'wickermoney_frame',
    remotes: [],
    shared: {
      react: { version: reactVersion, scope: 'default', lib: undefined, shareConfig: { singleton: true, requiredVersion: '^19.0.0' } },
      'react-dom': { version: reactDomVersion, scope: 'default', lib: undefined, shareConfig: { singleton: true, requiredVersion: '^19.0.0' } },
    },
  })
  registerRemotes([{ name, entry: params.entry, type: REMOTE_ENTRY_TYPE }])
  const loaded = await loadRemote<{ default: ComponentType<Record<string, unknown>> }>(
    `${name}/${params.module.replace(/^\.\//, '')}`,
  )
  if (loaded === null || loaded === undefined) throw new Error(`Plugin '${params.pluginId}' exposes no module '${params.module}'.`)
  return loaded.default
}
