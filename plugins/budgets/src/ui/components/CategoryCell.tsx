import { isZeroMoney } from '@wickermoney/plugin-sdk/money'
import type { MonthLine } from '../models/index.js'
import { WindowSummary } from './WindowSummary.js'

/** Props for {@link CategoryCell}. */
export interface CategoryCellProps {
  readonly line: MonthLine
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
  /** Formats a `YYYY-MM-DD` date for display. */
  readonly formatDate: (value: string) => string
}

/**
 * A line's category name, with the balance a rolling line brought in from
 * earlier months underneath it when there is one, or a window's dates and how
 * much of it is spent.
 */
export function CategoryCell({ line, formatMoney, formatDate }: CategoryCellProps) {
  const overdrawn = line.carriedIn.startsWith('-')
  if (line.window != null) {
    return (
      <span>
        {line.categoryName}
        <br />
        <WindowSummary window={line.window} formatMoney={formatMoney} formatDate={formatDate} />
      </span>
    )
  }
  return (
    <span>
      {line.categoryName}
      {line.rollover && !isZeroMoney(line.carriedIn) ? (
        <>
          <br />
          <span className={`bud__carry${overdrawn ? ' is-negative' : ''}`}>
            {overdrawn ? 'overdrawn ' : 'carried in '}
            {formatMoney(line.carriedIn)}
          </span>
        </>
      ) : null}
    </span>
  )
}
