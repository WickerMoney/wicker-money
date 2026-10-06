import { bar } from '../helpers/bar.js'
import { monthLabel } from '../helpers/monthLabel.js'
import { TREND_LAYOUT, type TrendLayout } from '../helpers/TREND_LAYOUT.js'
import type { MonthTotal } from '../models/index.js'

/** Props for {@link TrendMonthMark}. */
export interface TrendMonthMarkProps {
  readonly month: MonthTotal
  /** Left edge of the month's bar, in SVG units. */
  readonly x: number
  readonly barWidth: number
  /** The y coordinate of the zero line. */
  readonly zeroY: number
  /** Converts a value to a pixel height. */
  readonly scale: (value: number) => number
  /** Whether the pointer or keyboard focus is on this month. */
  readonly active: boolean
  /** Whether the month's name is drawn under the bar. */
  readonly labelled: boolean
  /** The month's figures in words, for screen readers and the native tooltip. */
  readonly description: string
  readonly onActivate: () => void
  readonly onDeactivate: () => void
  /** The drawing box; the full design width when omitted. */
  readonly layout?: TrendLayout
}

/**
 * One month of the income/spending chart: an income bar and an expense bar
 * around the zero line, with one full-height target covering both.
 *
 * Focusable as well as hoverable, because the exact figures live in the readout
 * and a keyboard has to be able to reach them.
 */
export function TrendMonthMark({
  month, x, barWidth, zeroY, scale, active, labelled, description, onActivate, onDeactivate, layout = TREND_LAYOUT,
}: TrendMonthMarkProps) {
  const { height, pad, radius } = layout
  const plotHeight = height - pad.top - pad.bottom
  const r = Math.min(radius, barWidth / 2)
  // Income is plotted upward and expense downward, but the sign has the final
  // say: a month whose refunds exceeded its spending has a negative expense
  // total and belongs above the line like any other money that came in.
  // Clamping it to zero would draw no bar while the legend still counted it, so
  // the chart and its own total would disagree.
  const income = bar(Number(month.income), zeroY, scale)
  const expense = bar(-Number(month.expense), zeroY, scale)
  return (
    <g
      tabIndex={0}
      role="listitem"
      aria-label={description}
      className={active ? 'viz__mark is-active' : 'viz__mark'}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
    >
      <title>{description}</title>
      {/* One full-height hit target for the pair, since a 2px bar is hard to
          aim at and a zero-height one has nothing to aim at. */}
      <rect x={x} y={pad.top} width={barWidth} height={plotHeight} fill="transparent" />
      <rect
        className="viz__bar" x={x} y={income.y} width={barWidth} height={income.h}
        rx={r} fill="var(--viz-1)"
      />
      <rect
        className="viz__bar" x={x} y={expense.y} width={barWidth} height={expense.h}
        rx={r} fill="var(--viz-2)"
      />
      {labelled ? (
        <text className="viz__axis" x={x + barWidth / 2} y={height - 8} textAnchor="middle">
          {monthLabel(month.month)}
        </text>
      ) : null}
    </g>
  )
}
