import { TREND_LAYOUT, type TrendLayout } from '../helpers/TREND_LAYOUT.js'

/** Props for {@link TrendGrid}. */
export interface TrendGridProps {
  /** Signed values at which a horizontal line is drawn. */
  readonly ticks: readonly number[]
  /** The y coordinate of the zero line. */
  readonly zeroY: number
  /** Converts a value to a pixel height. */
  readonly scale: (value: number) => number
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
  /** The drawing box; the full design width when omitted. */
  readonly layout?: TrendLayout
}

/**
 * The horizontal grid of the income/spending chart: one line per tick with its
 * label, the zero line drawn heavier than the rest.
 *
 * Labels show magnitudes, since the side of the zero line already says which way
 * the money went.
 */
export function TrendGrid({ ticks, zeroY, scale, formatMoney, layout = TREND_LAYOUT }: TrendGridProps) {
  const { width, pad } = layout
  return (
    <>
      {ticks.map((t) => {
        const y = zeroY - scale(t)
        return (
          <g key={t}>
            <line
              className={t === 0 ? 'viz__zero' : 'viz__grid'}
              x1={pad.left} x2={width - pad.right} y1={y} y2={y}
            />
            <text className="viz__axis" x={pad.left - 8} y={y + 4} textAnchor="end">
              {formatMoney(String(Math.round(Math.abs(t))))}
            </text>
          </g>
        )
      })}
    </>
  )
}
