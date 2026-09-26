import { Route } from 'react-router'
import { pagePath, type PluginContext, type PluginManifest } from '@wickermoney/plugin-sdk'
import { MountedPage } from './MountedPage.js'

/**
 * Builds the router entries for pages that plugins contribute.
 *
 * The routes are built from manifest data rather than declared in the router, so
 * the host has no list of plugin routes to keep in sync.
 *
 * @param plugins - The installed plugin manifests.
 * @param contextFor - Creates the scoped context handed to each plugin.
 * @returns One `<Route>` element per contributed page.
 */
export function pluginRoutes(
  plugins: readonly PluginManifest[],
  contextFor: (manifest: PluginManifest) => PluginContext,
) {
  return plugins.flatMap((manifest) =>
    manifest.contributes.pages.map((page) => (
      <Route
        key={pagePath(manifest.id, page)}
        path={pagePath(manifest.id, page)}
        element={
          <MountedPage manifest={manifest} module={page.module} title={page.title}
                       ctx={contextFor(manifest)} />
        }
      />
    )),
  )
}
