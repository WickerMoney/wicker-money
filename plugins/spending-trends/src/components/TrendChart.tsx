import { useState } from 'react'
import { axisLabel } from '../helpers/axisLabel.js'
import { labelEvery } from '../helpers/labelEvery.js'
import { niceScale } from '../helpers/niceScale.js'
import { readMonth } from '../helpers/readMonth.js'
import { stackExtent } from '../helpers/stackExtent.js'
import { stackMonth } from '../helpers/stackMonth.js'
import { tooltipAnchor } from '../helpers/tooltipAnchor.js'
import { trendLayout } from '../helpers/TREND_LAYOUT.js'
import { valueToY } from '../helpers/valueToY.js'
import { useElementWidth } from '../hooks/useElementWidth.js'
import type { Trend } from '../models/index.js'
import { StackedMonthMark } from './StackedMonthMark.js'
import { StackedTooltip } from './StackedTooltip.js'
import { TrendGrid } from './TrendGrid.js'

/** Props for {@link TrendChart}. */
export interface TrendChartProps {
  /** The chart's data. */
  readonly trend: Trend
  /** Each series' colour by id. */
  readonly colors: ReadonlyMap<string, string>
  /** The ids of the series the reader has turned off. */
  readonly hidden: ReadonlySet<string>
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
  /** The range's name, for the chart's accessible label. */
  readonly rangeLabel: string
}

/**
 * The stacked bar chart: one bar per month, one segment per visible category.
 *
 * **The axis is fitted to what is showing.** Hiding a category rescales the
 * y-axis to the ones that remain, so a small category is readable once a large
 * one is out of the way, which is what the filter is for.
 *
 * **Every month in the data gets a slot**, including empty ones; the data
 * arrives already filled to the range, so a gap in spending is a gap on the axis.
 *
 * Money is exact strings until this point. Everything here is geometry, where a
 * float is fine.
 */
export function TrendChart({ trend, colors, hidden, formatMoney, rangeLabel }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  // The plot is drawn at the width it is shown at; see trendLayout.
  const [plot, setPlot] = useState<HTMLDivElement | null>(null)
  const layout = trendLayout(useElementWidth(plot))
  const visible = trend.series.filter((s) => !hidden.has(s.id))
  if (visible.length === 0) {
    return (
      <p className="spt__hint" role="status">
        Every category is hidden. Turn one back on above.
      </p>
    )
  }

  const { width, height, pad, barFill } = layout
  const { maxUp, maxDown } = stackExtent(trend.months, visible)
  const scale = niceScale(maxUp, maxDown)
  const y = valueToY(scale, layout)
  const slot = (width - pad.left - pad.right) / trend.months.length
  const barWidth = Math.max(slot * barFill, 1)
  const every = labelEvery(trend.months.length)
  const readouts = trend.months.map((m) => readMonth(m, visible, colors, formatMoney))
  const active = hover === null ? undefined : readouts[hover]
  const barX = (i: number): number => pad.left + i * slot + (slot - barWidth) / 2

  return (
    <div className="spt__plot" ref={setPlot}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Spending by category, month by month (${rangeLabel})`}
      >
        <TrendGrid ticks={scale.ticks} y={y} formatMoney={formatMoney} layout={layout} />
        {trend.months.map((m, i) => (
          <StackedMonthMark
            key={m.month}
            segments={stackMonth(m, visible, y)}
            colors={colors}
            x={barX(i)}
            barWidth={barWidth}
            active={hover === i}
            label={i % every === 0 ? axisLabel(m.month, i === 0) : null}
            description={readouts[i]?.description ?? ''}
            onActivate={() => setHover(i)}
            onDeactivate={() => setHover(null)}
            layout={layout}
          />
        ))}
      </svg>

      {active === undefined ? null : (
        <StackedTooltip
          readout={active}
          anchor={tooltipAnchor(barX(hover ?? 0), barWidth, width)}
          formatMoney={formatMoney}
        />
      )}
    </div>
  )
}
