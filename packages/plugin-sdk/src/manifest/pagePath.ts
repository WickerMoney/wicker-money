import type { PageContribution } from './PageContribution.js'

/**
 * Builds the route a page contribution is mounted at.
 *
 * @param pluginId - The owning plugin's manifest id.
 * @param contribution - The page contribution whose `path` is being mounted.
 * @returns `/p/<pluginId>/<path>`, with any leading slashes on the contribution's
 * path removed. The host owns the `/p/<pluginId>/` prefix.
 */
export function pagePath(pluginId: string, contribution: PageContribution): string {
  const clean = contribution.path.replace(/^\/+/, '')
  return `/p/${pluginId}/${clean}`
}
