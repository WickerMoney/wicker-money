import { NavLink, Outlet } from 'react-router'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { AccountMenu } from './AccountMenu.js'
import { GearIcon } from './icons/GearIcon.js'
import { CORE_NAV } from './coreNav.js'
import { NavLinks } from './NavLinks.js'
import { navEntriesFor } from './navEntriesFor.js'

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** Loaded plugins, whose pages are added to the navigation. */
  readonly plugins: readonly PluginManifest[]
}

/**
 * The application chrome: sidebar navigation and the routed page.
 *
 * Plugin links are derived from manifests, never hardcoded, so installing a
 * plugin that contributes a page makes it appear here with no change to the
 * host. They are grouped by each page's declared `nav.section` (`main`,
 * `reports` or `settings`); a plugin's settings page belongs beside core's own
 * Settings entry rather than in the same list as its other pages.
 *
 * The account menu and a Settings gear are pinned to the bottom of the sidebar,
 * so they stay put however long the plugin navigation above them grows. Any
 * plugin settings pages are listed just above them.
 */
export function AppShell({ plugins }: AppShellProps) {
  const mainNav = navEntriesFor(plugins, 'main')
  const reportsNav = navEntriesFor(plugins, 'reports')
  const settingsNav = navEntriesFor(plugins, 'settings')

  return (
    <div className="shell">
      <aside className="shell__nav">
        <div className="shell__brand">Wicker Money</div>
        <nav className="shell__nav-main" aria-label="Primary">
          {CORE_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
                     className={({ isActive }) => `shell__link${isActive ? ' is-active' : ''}`}>
              {item.label}
            </NavLink>
          ))}

          {mainNav.length > 0 ? <div className="shell__nav-divider" /> : null}
          <NavLinks items={mainNav} />

          {reportsNav.length > 0 ? (
            <>
              <div className="shell__nav-divider" />
              <NavLinks items={reportsNav} />
            </>
          ) : null}
        </nav>

        <div className="shell__nav-foot">
          {/* Plugin settings pages have no gear of their own, so they keep a
              text link here, beside the core Settings gear below. */}
          {settingsNav.length > 0 ? (
            <nav aria-label="Plugin settings">
              <NavLinks items={settingsNav} />
            </nav>
          ) : null}
          <div className="shell__account-row">
            <AccountMenu />
            {/* Always present, Settings being a core page. */}
            <NavLink to="/settings" aria-label="Settings" title="Settings"
                     className={({ isActive }) => `shell__gear${isActive ? ' is-active' : ''}`}>
              <GearIcon />
            </NavLink>
          </div>
        </div>
      </aside>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  )
}
