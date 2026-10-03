import { useState } from 'react'
import { monthsInRange, type PluginWidgetProps } from '@wickermoney/plugin-sdk'
import { isZeroMoney, sumMoney } from '@wickermoney/plugin-sdk/money'
import { Alert, EmptyState, Spinner } from '@wickermoney/ui-kit'
import { TrendGrid } from './components/TrendGrid.js'
import { TrendLegend } from './components/TrendLegend.js'
import { TrendMonthMark } from './components/TrendMonthMark.js'
import { TrendTooltip } from './components/TrendTooltip.js'
import { labelEvery } from './helpers/labelEvery.js'
import { monthLabelLong } from './helpers/monthLabel.js'
import { totalsByMonth } from './helpers/totalsByMonth.js'
import { TREND_LAYOUT } from './helpers/TREND_LAYOUT.js'
import { useMonthlySummary } from './hooks/useMonthlySummary.js'
import type { MonthTotal } from './models/index.js'
import './styles.js'

const { width: W, height: H, pad: PAD, barGap: BAR_GAP } = TREND_LAYOUT

/**
 * A dashboard widget charting income against expense, month by month.
 *
 * **Diverging, not two bars side by side.** There is one zero line, with income
 * above it and expense below. The gap between the two is the month's net,
 * readable without arithmetic, and it halves the number of marks compared with
 * grouped pairs, which matters at 24 months where grouping means 48 bars in one
 * band.
 *
 * The colours are the palette's `--viz-1` and `--viz-2` slots (brand green and
 * amber); the shared palette puts that pair first for exactly this chart.
 * Green against red is the obvious choice and the wrong one: it collides for
 * deuteranopes on the dark surface. Position carries the meaning regardless,
 * since above the line is money in, so colour is reinforcement rather than the
 * only channel.
 *
 * **Every month in the range gets a slot**, including empty ones. The API
 * returns only months with activity, and drawing exactly those would put March
 * and September side by side as though they were consecutive.
 *
 * Exposed to the host as a default export.
 */
export default function TrendWidget({ ctx, range }: PluginWidgetProps) {
  const { rows, loading, error } = useMonthlySummary(ctx, range?.months ?? 12)
  const [hover, setHover] = useState<number | null>(null)

  if (loading) return <Spinner label="Loading spending" />
  if (error !== null) return <Alert>{error}</Alert>

  const months = totalsByMonth(rows, range === undefined ? undefined : monthsInRange(range))
  if (months.length === 0) {
    return <EmptyState title="Nothing recorded yet" hint="Add a transaction and it will show up here." />
  }

  // `!== zero`, not `> 0`: a month of pure refunds has a negative expense total
  // and is not an empty month.
  const active = months.some((m) => !isZeroMoney(m.income) || !isZeroMoney(m.expense))
  if (!active) {
    // Different from having no transactions at all, and worth saying so:
    // otherwise a too-narrow range looks like an empty ledger.
    return (
      <EmptyState
        title={`Nothing in the last ${range?.label.toLowerCase() ?? '12 months'}`}
        hint="Widen the range above to look further back."
      />
    )
  }

  // Magnitudes, so a negative total still sets the scale it needs rather than
  // being drawn off the edge of a band sized for the positive ones. Pixels, not
  // money, so floats are fine from here on.
  const peak = Math.max(
    ...months.map((m) => Math.max(Math.abs(Number(m.income)), Math.abs(Number(m.expense)))),
    1,
  )
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  // The zero line sits in the middle and both directions share one scale, so a
  // bar of a given value is the same height whichever way it points. Separate
  // scales would make income and expense incomparable while looking comparable,
  // which a diverging chart must not do.
  const zeroY = PAD.top + plotH / 2
  const half = plotH / 2
  const slot = plotW / months.length
  const barW = Math.max(slot - BAR_GAP, 1)
  const every = labelEvery(months.length)
  const scale = (v: number): number => (v / peak) * half

  const hovered = hover === null ? undefined : months[hover]
  const totals = {
    income: sumMoney(months.map((m) => m.income)),
    expense: sumMoney(months.map((m) => m.expense)),
  }

  const describe = (m: MonthTotal): string =>
    `${monthLabelLong(m.month)}: ${ctx.formatMoney(m.income)} in, ` +
    `${ctx.formatMoney(m.expense)} out, ${ctx.formatMoney(m.net)} net`

  return (
    <div className="viz viz--trend">
      <TrendLegend totals={totals} formatMoney={ctx.formatMoney} />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Income and spending per month over ${range?.label ?? 'the last 12 months'}`}
      >
        <TrendGrid
          ticks={[peak, peak / 2, 0, -peak / 2, -peak]}
          zeroY={zeroY}
          scale={scale}
          formatMoney={ctx.formatMoney}
        />
        {months.map((m, i) => (
          <TrendMonthMark
            key={m.month}
            month={m}
            x={PAD.left + i * slot + BAR_GAP / 2}
            barWidth={barW}
            zeroY={zeroY}
            scale={scale}
            active={hover === i}
            labelled={i % every === 0}
            description={describe(m)}
            onActivate={() => setHover(i)}
            onDeactivate={() => setHover(null)}
          />
        ))}
      </svg>

      {hovered !== undefined ? (
        <TrendTooltip
          month={hovered}
          leftPercent={((PAD.left + (hover ?? 0) * slot + slot / 2) / W) * 100}
          formatMoney={ctx.formatMoney}
        />
      ) : null}
    </div>
  )
}
