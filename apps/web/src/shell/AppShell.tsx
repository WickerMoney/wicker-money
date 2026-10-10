import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { useFocusTrap } from '@wickermoney/ui-kit'
import { useDocumentTitle } from '../hooks/useDocumentTitle.js'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { AccountMenu } from './AccountMenu.js'
import { GearIcon } from './icons/GearIcon.js'
import { MenuIcon } from './icons/MenuIcon.js'
import { CORE_NAV } from './coreNav.js'
import { NavLinks } from './NavLinks.js'
import { navEntriesFor } from './navEntriesFor.js'
import { pageTitleFor } from './pageTitleFor.js'

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
 *
 * On a phone the sidebar becomes a drawer: a compact top bar carries the logo
 * and a menu button, and the same navigation slides in over the page. The
 * drawer is one element restyled by CSS rather than a second copy of the
 * links, so desktop and phone cannot drift apart. It closes on navigation,
 * Escape and a tap on the scrim, and the page behind it is `inert` while it is
 * open so focus cannot wander into content the scrim is covering.
 *
 * Each route sets its own browser tab title, and a "Skip to content" link is
 * the first thing in the tab order. After navigating, focus moves to the page
 * (`<main>`) so keyboard and screen reader users start at the new content
 * rather than back in the sidebar; the first render is left alone so a fresh
 * page load does not scroll or steal focus.
 */
export function AppShell({ plugins }: AppShellProps) {
  const mainNav = navEntriesFor(plugins, 'main')
  const reportsNav = navEntriesFor(plugins, 'reports')
  const settingsNav = navEntriesFor(plugins, 'settings')

  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const focusMainPending = useRef(false)
  const firstRoute = useRef(true)

  useDocumentTitle(pageTitleFor(pathname, plugins))

  const closeNav = useCallback(() => {
    setNavOpen(false)
    menuButtonRef.current?.focus()
  }, [])
  useEscapeKey(navOpen, closeNav)
  // Tab wraps inside the open drawer (the skip link sits outside the inert
  // regions). Focus return is handled by closeNav, which targets the menu button.
  useFocusTrap(navRef, navOpen, { restoreFocus: false })

  // Following a link closes the drawer. Focus is left where the navigation put
  // it (the new page) rather than pulled back to the menu button. The route
  // effect covers navigation from anywhere; the click handler covers a tap on
  // the link for the page you are already on, which changes no route.
  useEffect(() => { setNavOpen(false) }, [pathname])

  // Hands focus to the new page after navigation. The page is `inert` while the
  // drawer is open, so on a phone this waits until the drawer has closed.
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return }
    focusMainPending.current = true
  }, [pathname])
  useEffect(() => {
    if (focusMainPending.current && !navOpen) {
      focusMainPending.current = false
      mainRef.current?.focus({ preventScroll: true })
    }
  }, [pathname, navOpen])
  const onNavClick = useCallback((e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a') !== null) setNavOpen(false)
  }, [])

  // Moves focus into the drawer when it opens, so a keyboard or screen reader
  // user lands in the navigation rather than behind the scrim.
  useEffect(() => {
    if (navOpen) navRef.current?.focus()
  }, [navOpen])

  const skipToContent = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    mainRef.current?.focus()
  }, [])

  return (
    <div className={`shell${navOpen ? ' is-nav-open' : ''}`}>
      <a className="shell__skip" href="#main" onClick={skipToContent}>Skip to content</a>
      <header className="shell__bar" inert={navOpen}>
        <button ref={menuButtonRef} type="button" className="shell__menu-btn"
                aria-label="Menu" aria-expanded={navOpen} aria-controls="shell-nav"
                onClick={() => { setNavOpen((o) => !o) }}>
          <MenuIcon />
        </button>
        <img className="shell__bar-logo shell__brand-logo--light" src="/brand/wordmark-light.png" alt="Wicker Money" />
        <img className="shell__bar-logo shell__brand-logo--dark" src="/brand/wordmark-dark.png" alt="Wicker Money" />
      </header>
      <div className="shell__scrim" aria-hidden="true" onClick={closeNav} />

      <aside id="shell-nav" ref={navRef} tabIndex={-1} className="shell__nav" onClick={onNavClick}>
        <div className="shell__brand">
          <img className="shell__brand-logo shell__brand-logo--light" src="/brand/wordmark-light.png" alt="Wicker Money" />
          <img className="shell__brand-logo shell__brand-logo--dark" src="/brand/wordmark-dark.png" alt="Wicker Money" />
        </div>
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

      <main id="main" ref={mainRef} tabIndex={-1} className="shell__main" inert={navOpen}>
        <Outlet />
      </main>
    </div>
  )
}
