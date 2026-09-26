import { NavLink, Outlet, useNavigate } from 'react-router'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { Button } from '@wickermoney/ui-kit'
import { useAuth } from '../auth/index.js'
import { CORE_NAV } from './coreNav.js'
import { NavLinks } from './NavLinks.js'
import { navEntriesFor } from './navEntriesFor.js'

/** Props for {@link AppShell}. */
export interface AppShellProps {
  /** Loaded plugins, whose pages are added to the navigation. */
  readonly plugins: readonly PluginManifest[]
}

/**
 * The application chrome: sidebar navigation, top bar and the routed page.
 *
 * Plugin links are derived from manifests, never hardcoded, so installing a
 * plugin that contributes a page makes it appear here with no change to the
 * host. They are grouped by each page's declared `nav.section` (`main`,
 * `reports` or `settings`); a plugin's settings page belongs beside core's own
 * Settings entry rather than in the same list as its other pages.
 */
export function AppShell({ plugins }: AppShellProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const mainNav = navEntriesFor(plugins, 'main')
  const reportsNav = navEntriesFor(plugins, 'reports')
  const settingsNav = navEntriesFor(plugins, 'settings')

  return (
    <div className="shell">
      <aside className="shell__nav">
        <div className="shell__brand">Wicker Money</div>
        <nav>
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

          {/* Settings is always present, being a core page, with any
              plugin-contributed settings page grouped alongside it. */}
          <div className="shell__nav-divider" />
          <NavLink to="/settings"
                   className={({ isActive }) => `shell__link${isActive ? ' is-active' : ''}`}>
            Settings
          </NavLink>
          <NavLinks items={settingsNav} />
        </nav>
      </aside>

      <header className="shell__top">
        <span className="shell__user">{user?.email}</span>
        <Button onClick={() => { void signOut().then(() => navigate('/')) }}>Sign out</Button>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  )
}
