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
 * @returns One `<Route>` element per contributed page, matching the page's address and any path under it.
 */
export function pluginRoutes(
  plugins: readonly PluginManifest[],
  contextFor: (manifest: PluginManifest) => PluginContext,
) {
  return plugins.flatMap((manifest) =>
    manifest.contributes.pages.map((page) => {
      const base = pagePath(manifest.id, page)
      return (
        // `/*` also matches the page's own address. A page in a frame is told the rest of the address
        // and may use it; for a page in the app's own realm `MountedPage` answers "not found" to any rest.
        <Route
          key={base}
          path={`${base}/*`}
          element={
            <MountedPage key={`${manifest.id}:${page.module}`} manifest={manifest} module={page.module}
                         title={page.title} ctx={contextFor(manifest)} basePath={base} />
          }
        />
      )
    }),
  )
}
