import { NavLink } from 'react-router'
import type { NavEntry } from './NavEntry.js'

/** Props for {@link NavLinks}. */
export interface NavLinksProps {
  /** The links to render, in display order. */
  readonly items: readonly NavEntry[]
}

/** Renders a list of sidebar links, highlighting the one for the current route. */
export function NavLinks({ items }: NavLinksProps) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `shell__link${isActive ? ' is-active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </>
  )
}
