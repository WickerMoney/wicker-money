import { useCallback, useId, useEffect, useRef, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/index.js'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../theme/index.js'
import { MonitorIcon } from './icons/MonitorIcon.js'
import { MoonIcon } from './icons/MoonIcon.js'
import { SunIcon } from './icons/SunIcon.js'

/** The label and icon for each theme. The label names the button, since the icon alone does not. */
const THEME_OPTIONS: Record<ThemePreference, { readonly label: string; readonly icon: ComponentType }> = {
  light: { label: 'Light', icon: SunIcon },
  dark: { label: 'Dark', icon: MoonIcon },
  system: { label: 'System', icon: MonitorIcon },
}

/**
 * The signed-in user's entry at the foot of the sidebar: their email, opening a
 * panel with the theme choice (three icon buttons) and sign out.
 *
 * A disclosure, not an ARIA menu: the trigger carries `aria-expanded` and the
 * panel holds ordinary buttons reached with Tab, so no arrow-key handling is
 * promised that is not there.
 *
 * The menu opens upward because the trigger is pinned to the bottom edge. It
 * stays open after a theme is picked so the change can be seen, and closes on
 * Escape or a click elsewhere.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeAndRefocus = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  useEscapeKey(open, closeAndRefocus)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const email = user?.email ?? ''

  return (
    <div className="account" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        title={email}
        onClick={() => { setOpen((o) => !o) }}
      >
        <span className="account__avatar" aria-hidden="true">
          {email.charAt(0).toUpperCase() || '?'}
        </span>
        <span className="account__email">{email}</span>
      </button>

      {open ? (
        <div className="account__menu" id={panelId} role="group" aria-label="Account">
          <div className="account__theme" role="group" aria-label="Theme">
            <span className="account__menu-label" aria-hidden="true">Theme</span>
            <div className="account__segments">
              {THEME_PREFERENCES.map((option) => {
                const { label, icon: Icon } = THEME_OPTIONS[option]
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={option === preference}
                    aria-label={label}
                    title={label}
                    className="account__segment"
                    onClick={() => { setPreference(option) }}
                  >
                    <Icon />
                  </button>
                )
              })}
            </div>
          </div>
          <div className="account__menu-divider" aria-hidden="true" />
          <button
            type="button"
            className="account__item"
            onClick={() => { void signOut().then(() => navigate('/')) }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}
