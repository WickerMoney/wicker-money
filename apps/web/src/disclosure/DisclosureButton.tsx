import type { ReactNode } from 'react'
import { Chevron } from './Chevron.js'

/** Props for {@link DisclosureButton}. */
export interface DisclosureButtonProps {
  /** Whether the controlled region is open. */
  readonly expanded: boolean
  /** Called on click. */
  readonly onToggle: () => void
  /** The `id` of the region this button shows and hides. */
  readonly controls: string
  /** The group's title and any badges. Becomes the button's accessible name. */
  readonly children: ReactNode
}

/** A full-width accordion header: an arrow, then the group's title. */
export function DisclosureButton({ expanded, onToggle, controls, children }: DisclosureButtonProps) {
  return (
    <button
      type="button" className="disclosure disclosure--header"
      aria-expanded={expanded} aria-controls={controls} onClick={onToggle}
    >
      <Chevron />
      {children}
    </button>
  )
}
