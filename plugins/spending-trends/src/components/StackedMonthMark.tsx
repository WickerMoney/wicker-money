import { segmentPath } from '../helpers/segmentPath.js'
import { TREND_LAYOUT } from '../helpers/TREND_LAYOUT.js'
import type { StackSegment } from '../models/index.js'

/** Props for {@link StackedMonthMark}. */
export interface StackedMonthMarkProps {
  /** The month's segments, already laid out. */
  readonly segments: readonly StackSegment[]
  /** Each series' colour by id. */
  readonly colors: ReadonlyMap<string, string>
  /** Left edge of the month's bar, in SVG units. */
  readonly x: number
  readonly barWidth: number
  /** Whether the pointer or keyboard focus is on this month. */
  readonly active: boolean
  /** The axis label under the bar, or `null` when this month is not labelled. */
  readonly label: string | null
  /** The month's figures in words, for screen readers and the native tooltip. */
  readonly description: string
  readonly onActivate: () => void
  readonly onDeactivate: () => void
}

/**
 * One month of the stacked chart: a bar of category segments, with one
 * full-height target covering it.
 *
 * Focusable as well as hoverable, because the exact figures live in the readout
 * and a keyboard has to be able to reach them.
 */
export function StackedMonthMark({
  segments, colors, x, barWidth, active, label, description, onActivate, onDeactivate,
}: StackedMonthMarkProps) {
  const { height, pad, radius } = TREND_LAYOUT
  const plotHeight = height - pad.top - pad.bottom
  return (
    <g
      tabIndex={0}
      role="listitem"
      aria-label={description}
      className={active ? 'spt__mark is-active' : 'spt__mark'}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
    >
      <title>{description}</title>
      {/* One full-height hit target, since a 2px segment is hard to aim at and a
          month with nothing has nothing to aim at. */}
      <rect x={x} y={pad.top} width={barWidth} height={plotHeight} fill="transparent" />
      {segments.map((s) => (
        <path
          key={s.id}
          data-series={s.id}
          className="spt__segment"
          d={segmentPath(x, s.y, barWidth, s.h, radius, s.rounding)}
          fill={colors.get(s.id) ?? 'currentColor'}
        />
      ))}
      {label === null ? null : (
        <text className="spt__axis" x={x + barWidth / 2} y={height - 10} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}
