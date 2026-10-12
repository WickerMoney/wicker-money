import { SDK_MAJOR_VERSION, type PluginManifest } from '@wickermoney/plugin-sdk'

/**
 * @module
 * The manifest of the hostile fixture plugin that the ADR 0005 test suite runs.
 *
 * The plugin exists only in tests. It is added to the registry through the
 * `pluginOptions.bundled` seam of `buildApp`, never listed in `BUNDLED_PLUGINS`,
 * and is not an example to copy: its code (`apps/web/browser-check/hostile/`)
 * is written to misbehave. The manifest is the honest part: it asks for one
 * table, read-only, and nothing else, so every attempt to reach further is an
 * attempt to exceed a small, known grant.
 */

/** The fixture plugin's manifest id. */
export const HOSTILE_PLUGIN_ID = 'acme.hostile'

/** Where the browser suite serves the fixture's `remoteEntry`, under the web app's `/plugins/` prefix. */
export const HOSTILE_REMOTE_ENTRY = '/plugins/hostile/remoteEntry.js'

/**
 * Builds the fixture manifest.
 *
 * @param widgets - Exposed module keys (or a key and a title), one dashboard widget each. Defaults to none: the API tests only need the grant.
 * @param pages - Whether to contribute a `report` page (module `./Page`).
 * @returns A manifest granting `transactions` read and nothing else.
 */
export function hostileManifest(widgets: ReadonlyArray<string | { readonly module: string; readonly title: string }> = [], pages = false): PluginManifest {
  return {
    id: HOSTILE_PLUGIN_ID,
    name: 'Hostile',
    version: '0.0.1',
    description: 'Test fixture that tries to break out of the isolated runtime.',
    author: 'test',
    sdkVersion: SDK_MAJOR_VERSION,
    permissions: [],
    requiredTables: [{ table: 'transactions', access: 'read' }],
    remoteEntry: HOSTILE_REMOTE_ENTRY,
    contributes: {
      pages: pages ? [{ id: 'report', path: 'report', title: 'Hostile page', module: './Page', nav: { label: 'Hostile' } }] : [],
      widgets: widgets.map((w, i) => ({
        id: `w${i + 1}`, slot: 'dashboard.primary', title: typeof w === 'string' ? `Widget ${i + 1}` : w.title,
        defaultSize: 'md', order: i + 1, module: typeof w === 'string' ? w : w.module,
      })),
      endpoints: false,
      exporters: false,
    },
  } as unknown as PluginManifest
}
