import type { LineWindow } from '../models/index.js'

/** Props for {@link WindowSummary}. */
export interface WindowSummaryProps {
  readonly window: LineWindow
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * The line under a window's category name: its dates, and how much of the
 * pot is gone. This is the "spent so far, October to December" figure, which
 * no single month's columns show.
 */
export function WindowSummary({ window, formatMoney, formatDate }: WindowSummaryProps) {
  return (
    <span className="bud__carry">
      {formatDate(window.start)} – {formatDate(window.through)}
      {' · '}
      {formatMoney(window.spentToDate)} of {formatMoney(window.funded)} spent
    </span>
  )
}
