import type { PluginManifest } from '@wickermoney/plugin-sdk'
import type { RegisteredPlugin } from '../../../models/index.js'

/**
 * Describes a loaded plugin in the shape the owner listing uses, for the
 * read-only view a member gets. Everything a member's app has loaded is, by
 * definition, enabled.
 *
 * @param manifest - A manifest from the loaded registry.
 * @returns The plugin as a listing row.
 */
export function manifestToRegistered(manifest: PluginManifest): RegisteredPlugin {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description === '' ? null : manifest.description,
    author: manifest.author === '' ? null : manifest.author,
    version: manifest.version,
    // A member's registry says nothing about where a plugin came from.
    bundled: false,
    enabled: true,
    status: 'enabled',
    failure: null,
    contributes: {
      pages: manifest.contributes.pages.map((p) => p.title),
      widgets: manifest.contributes.widgets.map((w) => w.title),
      endpoints: manifest.contributes.endpoints,
    },
  }
}
