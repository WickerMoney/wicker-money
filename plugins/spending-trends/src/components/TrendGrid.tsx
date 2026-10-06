import { TREND_LAYOUT, type TrendLayout } from '../helpers/TREND_LAYOUT.js'

/** Props for {@link TrendGrid}. */
export interface TrendGridProps {
  /** Signed values at which a horizontal line is drawn. */
  readonly ticks: readonly number[]
  /** Converts a value to a y coordinate. */
  readonly y: (value: number) => number
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
  /** The drawing box; the full design width when omitted. */
  readonly layout?: TrendLayout
}

/**
 * The horizontal grid: one line per tick with its label, the zero line drawn
 * heavier than the rest because it is where every bar starts.
 */
export function TrendGrid({ ticks, y, formatMoney, layout = TREND_LAYOUT }: TrendGridProps) {
  const { width, pad } = layout
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line
            className={t === 0 ? 'spt__zero' : 'spt__grid'}
            x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)}
          />
          <text className="spt__axis" x={pad.left - 8} y={y(t) + 4} textAnchor="end">
            {formatMoney(String(Math.round(t)))}
          </text>
        </g>
      ))}
    </>
  )
}
