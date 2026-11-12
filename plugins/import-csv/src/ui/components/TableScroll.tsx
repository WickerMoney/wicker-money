import type { ReactNode } from 'react'

/** Props for {@link TableScroll}. */
export interface TableScrollProps {
  /** What the table lists, for the scrollable region's name. */
  readonly label: string
  readonly children: ReactNode
}

/**
 * Lets a wide table scroll sideways inside its own section.
 *
 * At phone width these tables are wider than the page, and in a frame that
 * widens the whole document, which the host then cannot show without a
 * horizontal scroll of its own. The region takes focus so a keyboard can
 * scroll it, which is also what axe asks of a scrollable region.
 */
export function TableScroll({ label, children }: TableScrollProps) {
  return (
    <div className="imp__scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  )
}
