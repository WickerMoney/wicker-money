import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Button } from '@wickermoney/ui-kit'
import type { PayoffPlan } from '../../shared/index.js'
import { areaPath } from '../helpers/areaPath.js'
import { axisMoney } from '../helpers/axisMoney.js'
import { axisMonth } from '../helpers/axisMonth.js'
import { buildChartModel } from '../helpers/buildChartModel.js'
import { chartLayout } from '../helpers/CHART_LAYOUT.js'
import { describeMonth } from '../helpers/describeMonth.js'
import { labelStep } from '../helpers/labelStep.js'
import { niceTicks } from '../helpers/niceTicks.js'
import { readMonth } from '../helpers/readMonth.js'
import { useElementWidth } from '../hooks/useElementWidth.js'
import { PayoffTooltip } from './PayoffTooltip.js'
import { ScheduleTable } from './ScheduleTable.js'

/** Props for {@link PayoffChart}. */
export interface PayoffChartProps {
  readonly plan: PayoffPlan
  /** Each active debt's colour by id; a debt without one is folded into the grey "other" band. */
  readonly colors: ReadonlyMap<string, string>
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * What is owed, month by month, until it reaches zero: a stacked area with one
 * band per debt.
 *
 * **The stack shows the order.** The debt the plan clears first sits on top and
 * shrinks away first, so the strategy is visible rather than described. Colour
 * follows the debt, not its rank, so switching strategy reorders the bands
 * without repainting them; debts past the sixth share one grey band.
 *
 * **It can be read without the picture.** The chart takes focus, the arrow
 * keys (and Home, End, Page Up and Page Down) step through the months, and a
 * live region that is always mounted says each month in a sentence. "Show as
 * table" swaps the drawing for the month-by-month table of the same figures.
 *
 * Money is exact strings everywhere it is shown. Numbers appear here only to
 * place pixels.
 */
export function PayoffChart({ plan, colors, formatMoney, formatDate }: PayoffChartProps) {
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [plot, setPlot] = useState<HTMLDivElement | null>(null)
  const measured = useElementWidth(plot)
  const layout = useMemo(() => chartLayout(measured), [measured])
  const model = useMemo(() => buildChartModel(plan, colors), [plan, colors])

  // Geometry depends on the data and the width, not on the point under the
  // pointer, so hovering redraws the cursor without recomputing the areas.
  const drawn = useMemo(() => {
    if (model === null) return null
    const { width, height, pad } = layout
    const points = model.dates.length
    const plotW = width - pad.left - pad.right
    const plotH = height - pad.top - pad.bottom
    const ticks = niceTicks(model.max)
    const top = ticks[ticks.length - 1] ?? 1
    const x = (i: number) => pad.left + (i / (points - 1)) * plotW
    const y = (v: number) => pad.top + (1 - v / top) * plotH
    const floor = new Array<number>(points).fill(0)
    const areas = model.bands.map((band) => {
      const lower = floor.slice()
      const upper = band.values.map((v, i) => (floor[i] ?? 0) + v)
      upper.forEach((v, i) => { floor[i] = v })
      return {
        id: band.id,
        color: band.color,
        d: areaPath(lower.map(y), upper.map(y), x),
      }
    })
    return { points, plotW, ticks, x, y, areas, every: labelStep(points, plotW) }
  }, [model, layout])

  if (model === null || drawn === null) return null

  const { width, height, pad } = layout
  const { points, ticks, x, y, areas, every } = drawn
  const move = (i: number) => setHover(Math.max(0, Math.min(points - 1, i)))
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const svgX = ((e.clientX - box.left) / box.width) * width
    move(Math.round(((svgX - pad.left) / drawn.plotW) * (points - 1)))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = hover ?? 0
    const step = { ArrowRight: 1, ArrowLeft: -1, PageDown: 12, PageUp: -12 }[e.key]
    if (step !== undefined) { e.preventDefault(); move(at + step) }
    else if (e.key === 'Home') { e.preventDefault(); move(0) }
    else if (e.key === 'End') { e.preventDefault(); move(points - 1) }
    else if (e.key === 'Escape') setHover(null)
  }

  const readout = hover === null ? null : readMonth(plan, model, hover, formatMoney)
  const last = model.dates[points - 1] ?? plan.startDate
  const label =
    `Total owed, month by month, from ${formatDate(plan.startDate)} to ${formatDate(last)}, one band for each debt. `
    + 'Use the left and right arrow keys to read each month.'

  return (
    <div className="dp-chart">
      <div className="dp-chart__view">
        <Button onClick={() => { setHover(null); setAsTable((v) => !v) }}>
          {asTable ? 'Show as chart' : 'Show as table'}
        </Button>
      </div>

      {asTable ? (
        <ScheduleTable plan={plan} formatMoney={formatMoney} formatDate={formatDate} />
      ) : (
        <div className="dp-chart__plot" ref={setPlot}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={label}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerLeave={() => setHover(null)}
            onFocus={() => { if (hover === null) setHover(0) }}
            onBlur={() => setHover(null)}
            onKeyDown={onKey}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="dp-chart__grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
                <text className="dp-chart__axis" x={pad.left - 8} y={y(t) + 4} textAnchor="end">
                  {axisMoney(t, formatMoney)}
                </text>
              </g>
            ))}
            {model.dates.map((date, i) => (i % every === 0 ? (
              <text
                key={date}
                className="dp-chart__axis"
                x={x(i)}
                y={height - 10}
                textAnchor={i === 0 ? 'start' : x(i) > width - pad.right - 30 ? 'end' : 'middle'}
              >
                {i === 0 ? 'Today' : axisMonth(date)}
              </text>
            ) : null))}
            {areas.map((a) => (
              <path key={a.id} className="dp-chart__area" d={a.d} fill={a.color} />
            ))}
            {hover !== null ? (
              <line className="dp-chart__cursor" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} />
            ) : null}
          </svg>
          {/* Always mounted, so a screen reader is already watching it when the
              text changes; a region that appears with its content is often missed. */}
          <div className="wm-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {readout === null ? '' : describeMonth(readout, formatDate)}
          </div>
          {readout !== null ? (
            <PayoffTooltip readout={readout} leftPercent={(x(readout.index) / width) * 100} formatDate={formatDate} />
          ) : null}
        </div>
      )}

      {!asTable && model.bands.length > 1 ? (
        <ul className="dp-legend" aria-label="Key to the chart, top band first">
          {[...model.bands].reverse().map((b) => (
            <li key={b.id}>
              <span className="dp-swatch" aria-hidden="true" style={{ background: b.color }} />
              {b.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
