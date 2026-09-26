import type { MonthLine } from '../models/index.js'

/** Props for {@link CategoryCell}. */
export interface CategoryCellProps {
  readonly line: MonthLine
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * A line's category name, with the balance a rolling line brought in from
 * earlier months underneath it when there is one.
 */
export function CategoryCell({ line, formatMoney }: CategoryCellProps) {
  const overdrawn = line.carriedIn.startsWith('-')
  return (
    <span>
      {line.categoryName}
      {line.rollover && line.carriedIn !== '0.0000' ? (
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
