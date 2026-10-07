import { pagePath, type PluginManifest } from '@wickermoney/plugin-sdk'
import { CORE_NAV } from './coreNav.js'

/** The product name every page title ends with. */
export const APP_TITLE = 'Wicker Money'

/**
 * Builds the browser tab title for a route, so each page has its own title and
 * a screen reader announces where the user has landed.
 *
 * The longest route that matches the path wins, so a plugin page nested under
 * another route is named after itself. Core pages are named from the sidebar,
 * and plugin pages from their manifest `title`.
 *
 * @param pathname - The current location's path.
 * @param plugins - The loaded plugin manifests.
 * @returns For example `"Accounts - Wicker Money"`; `"Plugin unavailable"` for a
 * plugin address with no page behind it, and `"Page not found"` otherwise.
 */
export function pageTitleFor(pathname: string, plugins: readonly PluginManifest[]): string {
  const routes = [
    ...CORE_NAV.map(({ to, label }) => ({ to, label })),
    { to: '/settings', label: 'Settings' },
    ...plugins.flatMap((manifest) =>
      manifest.contributes.pages.map((page) => ({ to: pagePath(manifest.id, page), label: page.title })),
    ),
  ]
  const match = routes
    .filter(({ to }) => pathname === to || (to !== '/' && pathname.startsWith(`${to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]
  const name = match?.label ?? (pathname.startsWith('/p/') ? 'Plugin unavailable' : 'Page not found')
  return `${name} - ${APP_TITLE}`
}
