import { init, loadRemote } from '@module-federation/runtime'
import { version as reactVersion } from 'react'
import { version as reactDomVersion } from 'react-dom'
import {
  federationName, type PluginManifest,
} from '@wickermoney/plugin-sdk'
import { api } from '../api/client.js'
import type { PluginLoadFailure } from './PluginLoadFailure.js'
import type { PluginRegistry } from './PluginRegistry.js'
import { registerOne } from './registerOne.js'

let initialised = false

function ensureInit(): void {
  if (initialised) return
  init({
    name: 'wickermoney_host',
    remotes: [],
    shared: {
      // Declared again at runtime because remotes are registered dynamically,
      // after the build-time config has already been applied. The versions are
      // read from the copies actually running, not written down: the federation
      // runtime prefers the highest version on offer, so a host claiming an
      // older one than it runs would lose to a remote's own copy and the page
      // would end up with two Reacts.
      react: { version: reactVersion, scope: 'default', lib: undefined, shareConfig: { singleton: true, requiredVersion: '^19.0.0' } },
      'react-dom': { version: reactDomVersion, scope: 'default', lib: undefined, shareConfig: { singleton: true, requiredVersion: '^19.0.0' } },
    },
  })
  initialised = true
}

/**
 * Fetches the enabled plugins and registers each as a federation remote.
 *
 * Every manifest is validated here as well as on the server. The server is the
 * authority, but the host should not render a widget from a manifest it could
 * not itself parse — and a bad manifest must cost exactly one plugin, never the
 * dashboard.
 *
 * @returns The manifests that registered successfully and, separately, a
 *   failure entry for every plugin the server or host could not load.
 * @throws {ApiError} If the plugin list request itself fails.
 */
export async function loadPluginRegistry(): Promise<PluginRegistry> {
  ensureInit()

  const response = await api.get<{ plugins: unknown[]; failures?: PluginLoadFailure[] }>('/plugins')
  const plugins: PluginManifest[] = []
  const failures: PluginLoadFailure[] = [...(response.failures ?? [])]

  for (const raw of response.plugins) {
    const manifest = registerOne(raw, failures)
    if (manifest !== undefined) plugins.push(manifest)
  }

  return { plugins, failures }
}

/**
 * Loads one exposed module from a plugin.
 *
 * `module` is the manifest's exposed key ("./TrendWidget"); MF addresses it as
 * "<container>/TrendWidget".
 *
 * @param pluginId - The plugin's manifest id.
 * @param module - The exposed module key from the manifest, e.g. `./TrendWidget`.
 * @returns The module's default export, typed by the caller.
 * @throws {Error} If the remote exposes no such module, or the remote cannot be loaded.
 */
export async function loadPluginModule<T>(pluginId: string, module: string): Promise<T> {
  ensureInit()
  const exposed = module.replace(/^\.\//, '')
  const loaded = await loadRemote<{ default: T }>(`${federationName(pluginId)}/${exposed}`)
  if (loaded === null || loaded === undefined) {
    throw new Error(`Plugin '${pluginId}' exposes no module '${module}'.`)
  }
  return loaded.default
}
