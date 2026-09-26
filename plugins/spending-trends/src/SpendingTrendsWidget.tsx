import { useMemo } from 'react'
import { monthsInRange, type PluginWidgetProps } from '@wickermoney/plugin-sdk'
import { Alert, EmptyState, Spinner } from '@wickermoney/ui-kit'
import { SeriesFilter } from './components/SeriesFilter.js'
import { TrendChart } from './components/TrendChart.js'
import { buildTrend } from './helpers/buildTrend.js'
import { hasSpending } from './helpers/hasSpending.js'
import { seriesColor } from './helpers/seriesColor.js'
import { useHiddenSeries } from './hooks/useHiddenSeries.js'
import { useMonthlySummary } from './hooks/useMonthlySummary.js'
import './styles.js'

/**
 * A dashboard widget charting spending month by month, stacked by category.
 *
 * The five largest categories over the range are named and the rest fold into
 * "Other", because the palette has a fixed number of validated slots; the chips
 * above the chart double as the legend and as a filter. Turning a category off
 * removes it from the bars and refits the axis.
 *
 * It reads the same monthly-summary aggregate as the insights widgets, under a
 * `transactions` and `categories` read grant and nothing else, so it has no
 * server half and no schema of its own.
 *
 * **It honours the dashboard's range** and fills every month in it, so a quiet
 * month is a visible gap rather than two bars pushed together.
 *
 * Exposed to the host as a default export.
 */
export default function SpendingTrendsWidget({ ctx, range }: PluginWidgetProps) {
  const { rows, loading, error } = useMonthlySummary(ctx, range?.months ?? 12)
  const { hidden, toggle } = useHiddenSeries()
  const expected = useMemo(() => (range === undefined ? undefined : monthsInRange(range)), [range])
  const trend = useMemo(() => buildTrend(rows, { expected }), [rows, expected])
  const colors = useMemo(
    () => new Map(trend.series.map((s, rank) => [s.id, seriesColor(s, rank)] as const)),
    [trend],
  )

  if (loading) return <Spinner label="Loading spending trends" />
  if (error !== null) return <Alert>{error}</Alert>

  if (!hasSpending(trend)) {
    // Different from having no transactions at all, and worth saying so:
    // otherwise a too-narrow range looks like an empty ledger.
    return range === undefined ? (
      <EmptyState title="No spending yet" hint="Categorized expenses will appear here once you have transactions." />
    ) : (
      <EmptyState title="No spending in this range" hint="Widen the range above to look further back." />
    )
  }

  return (
    <div className="spt">
      <SeriesFilter
        series={trend.series}
        colors={colors}
        hidden={hidden}
        onToggle={toggle}
        formatMoney={ctx.formatMoney}
      />
      <TrendChart
        trend={trend}
        colors={colors}
        hidden={hidden}
        formatMoney={ctx.formatMoney}
        rangeLabel={range?.label ?? '12 months'}
      />
    </div>
  )
}
