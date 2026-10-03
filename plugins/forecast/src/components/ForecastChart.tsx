import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { axisDates } from '../helpers/axisDates.js'
import { axisMoney } from '../helpers/axisMoney.js'
import { chartLayout } from '../helpers/CHART_LAYOUT.js'
import { isPositiveAmount } from '../helpers/isPositiveAmount.js'
import { niceTicks } from '../helpers/niceTicks.js'
import { shortDate } from '../helpers/shortDate.js'
import { stepPath } from '../helpers/stepPath.js'
import type { ForecastDay, ForecastEntry } from '../models/index.js'
import { useWidth } from '../hooks/useWidth.js'
import { ForecastTooltip } from './ForecastTooltip.js'

/** Props for {@link ForecastChart}. */
export interface ForecastChartProps {
  /** The user's today; drawn as the first step, at today's balance. */
  readonly today: string
  /** Today's balance. */
  readonly start: string
  /** The projected days, from tomorrow. */
  readonly days: readonly ForecastDay[]
  /** Occurrences on the account, for the hover readout. */
  readonly entries: readonly ForecastEntry[]
  /** The account's buffer, drawn as a dashed line when above zero. */
  readonly buffer: string
  /** Whether to draw the zero and buffer lines and shade overdraft (checking and savings). */
  readonly cash: boolean
  /** What the chart shows, for screen readers. */
  readonly label: string
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * The projected balance as a step chart.
 *
 * A step, not a smoothed curve: a balance jumps when money moves and is flat
 * in between, and a spline would draw it drifting through values it never
 * has (the old app's chart did, and made a bill look like a slow leak). Each
 * day's dip is drawn in, so a bill due before a paycheck on the same day
 * shows. Zero is a solid line and the buffer a dashed one, with the area
 * below zero shaded, so the page answers "do I go under?" at a glance.
 *
 * Hover, or focus and use the arrow keys, for a day's balance, its low and
 * what lands on it. Money is a string everywhere else; here it is converted
 * to numbers only to place pixels.
 */
export function ForecastChart({
  today, start, days, entries, buffer, cash, label, formatMoney, formatDate,
}: ForecastChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const [frame, measured] = useWidth<HTMLDivElement>(1200)
  const { width: W, height: H, pad: PAD } = chartLayout(measured)

  const dates = [today, ...days.map((d) => d.date)]
  const points = [
    { low: Number(start), balance: Number(start) },
    ...days.map((d) => ({ low: Number(d.low), balance: Number(d.balance) })),
  ]
  const bufferValue = Number(buffer)
  const showBuffer = cash && isPositiveAmount(buffer)

  const values = points.flatMap((p) => [p.low, p.balance])
  if (cash) values.push(0)
  if (showBuffer) values.push(bufferValue)
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const lo = ticks[0]!
  const hi = ticks[ticks.length - 1]!

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / points.length
  const x = (i: number) => PAD.left + i * slot
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH
  const zeroY = y(0)

  const move = (i: number) => setHover(Math.max(0, Math.min(points.length - 1, i)))
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const svgX = ((e.clientX - box.left) / box.width) * W
    move(Math.floor((svgX - PAD.left) / slot))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = hover ?? 0
    const step = { ArrowRight: 1, ArrowLeft: -1, PageDown: 7, PageUp: -7 }[e.key]
    if (step !== undefined) { e.preventDefault(); move(at + step) }
    if (e.key === 'Home') { e.preventDefault(); move(0) }
    if (e.key === 'End') { e.preventDefault(); move(points.length - 1) }
    if (e.key === 'Escape') setHover(null)
  }

  const monthly = dates.length > 45
  const hovered = hover === null ? undefined : dates[hover]

  return (
    <div className="fc-chart" ref={frame}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
        onFocus={() => { if (hover === null) setHover(0) }}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {cash && lo < 0 ? (
          <rect className="fc-chart__overdraft" x={PAD.left} y={zeroY} width={plotW} height={y(lo) - zeroY} />
        ) : null}
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 && cash ? 'fc-chart__zero' : 'fc-chart__grid'} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="fc-chart__axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {axisMoney(t, formatMoney)}
            </text>
          </g>
        ))}
        {showBuffer ? (
          <g>
            <line className="fc-chart__buffer" x1={PAD.left} x2={W - PAD.right} y1={y(bufferValue)} y2={y(bufferValue)} />
            <text className="fc-chart__buffer-label" x={W - PAD.right - 4} y={y(bufferValue) - 5} textAnchor="end">
              Buffer {formatMoney(buffer)}
            </text>
          </g>
        ) : null}
        {axisDates(dates, plotW).map((i) => {
          // A label near the right edge hangs left of its day instead of off the chart.
          const nearEnd = x(i) > W - PAD.right - 40
          return (
            <text key={dates[i]} className="fc-chart__axis" x={nearEnd ? x(i + 1) : x(i) + 2} y={H - 10} textAnchor={nearEnd ? 'end' : 'start'}>
              {i === 0 ? 'Today' : shortDate(dates[i]!, monthly && dates[i]!.endsWith('-01'))}
            </text>
          )
        })}
        {hover !== null ? (
          <rect className="fc-chart__cursor" x={x(hover)} y={PAD.top} width={Math.max(slot, 1)} height={plotH} />
        ) : null}
        <path className="fc-chart__line" d={stepPath(points, x, y)} />
      </svg>
      {hovered !== undefined && hover !== null ? (
        <ForecastTooltip
          date={hovered}
          isToday={hover === 0}
          balance={hover === 0 ? start : days[hover - 1]!.balance}
          low={hover === 0 ? start : days[hover - 1]!.low}
          entries={entries.filter((e) => e.date === hovered && e.status !== 'cleared')}
          leftPercent={((x(hover) + slot / 2) / W) * 100}
          formatMoney={formatMoney}
          formatDate={formatDate}
        />
      ) : null}
    </div>
  )
}
