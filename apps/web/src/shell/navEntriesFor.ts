import { pagePath, type PluginManifest } from '@wickermoney/plugin-sdk'
import type { NavEntry } from './NavEntry.js'
import type { NavSection } from './NavSection.js'

/**
 * Collects the navigation links that installed plugins contribute to one section.
 *
 * @param plugins - The installed plugin manifests.
 * @param section - The navigation section to collect.
 * @returns The links, sorted by their declared `nav.order` (default 100).
 */
export function navEntriesFor(plugins: readonly PluginManifest[], section: NavSection): NavEntry[] {
  return plugins
    .flatMap((manifest) =>
      manifest.contributes.pages
        .filter((page) => page.nav !== undefined && page.nav.section === section)
        .map((page) => ({
          to: pagePath(manifest.id, page),
          label: page.nav?.label ?? page.title,
          order: page.nav?.order ?? 100,
        })),
    )
    .sort((a, b) => a.order - b.order)
}
