import { useState } from 'react'
import type { PluginWidgetProps } from '@wickermoney/plugin-sdk'
import { sumMoney } from '@wickermoney/plugin-sdk/money'
import { Alert, EmptyState, Spinner } from '@wickermoney/ui-kit'
import { DonutLegend } from './components/DonutLegend.js'
import { arc } from './helpers/arc.js'
import { topCategories } from './helpers/topCategories.js'
import { useMonthlySummary } from './hooks/useMonthlySummary.js'
import './styles.js'

const SIZE = 180
const R_OUTER = 78
const R_INNER = 52
const GAP_DEG = 1.4 // gap between adjacent segments, in degrees

// Fixed slot order. Never cycled: a seventh category folds into "Other".
const SLOTS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)']

/**
 * A dashboard widget showing spending by category over the dashboard's range, as
 * a donut with a legend.
 *
 * The legend carries each name and value in text ink beside its swatch, so
 * identity never rests on colour alone. At most five categories are named and the
 * rest fold into "Other", because the palette has a fixed number of slots.
 *
 * Exposed to the host as a default export.
 */
export default function DonutWidget({ ctx, range }: PluginWidgetProps) {
  const { rows, loading, error } = useMonthlySummary(ctx, range?.months ?? 12)
  const [hover, setHover] = useState<number | null>(null)

  if (loading) return <Spinner label="Loading categories" />
  if (error !== null) return <Alert>{error}</Alert>

  const cats = topCategories(rows, 5)
  if (cats.length === 0) {
    return (
      <EmptyState
        title={`Nothing categorized in the last ${range?.label.toLowerCase() ?? '12 months'}`}
        hint="Categorize a transaction, or widen the range above."
      />
    )
  }

  const total = sumMoney(cats.map((c) => c.total))
  // Angles and percentages are geometry, not money, so floats are fine here.
  const totalValue = Number(total)
  const colourFor = (i: number, name: string) =>
    name === 'Other' ? 'var(--viz-other)' : (SLOTS[i] ?? 'var(--viz-other)')

  let cursor = 0
  const segments = cats.map((c, i) => {
    const sweep = totalValue > 0 ? (Number(c.total) / totalValue) * 360 : 0
    const a0 = cursor
    const a1 = cursor + sweep
    cursor = a1
    return { ...c, a0, a1, colour: colourFor(i, c.name) }
  })

  const active = hover === null ? undefined : segments[hover]

  return (
    <div className="viz viz--donut">
      {/* A list, not an image: an img makes its children presentational, which
          would drop the focusable slices out of the accessibility tree. */}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="list" aria-label="Spending by category">
        {segments.map((s, i) => {
          // Trim each segment so neighbours never touch; skip the trim when the
          // slice is too thin to survive it.
          const trim = s.a1 - s.a0 > GAP_DEG * 2 ? GAP_DEG / 2 : 0
          const share = totalValue > 0 ? Math.round((Number(s.total) / totalValue) * 100) : 0
          return (
            <path
              key={s.name}
              d={arc(SIZE / 2, SIZE / 2, R_OUTER, R_INNER, s.a0 + trim, s.a1 - trim)}
              fill={s.colour}
              className={hover === i ? 'viz__bar is-active' : 'viz__bar'}
              tabIndex={0}
              role="listitem"
              aria-label={`${s.name}: ${ctx.formatMoney(s.total)}, ${share}%`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <title>{`${s.name}: ${ctx.formatMoney(s.total)} (${share}%)`}</title>
            </path>
          )
        })}
        {/* The hole is the readout: a donut's centre is where the eye rests, so
            the hovered slice's figure costs no extra ink and needs no floating
            box over the artwork. */}
        <text className="viz__center" x={SIZE / 2} y={SIZE / 2 - 2}>
          <tspan className="viz__center-value">
            {ctx.formatMoney(active?.total ?? total)}
          </tspan>
        </text>
        <text className="viz__center viz__center-label" x={SIZE / 2} y={SIZE / 2 + 14}>
          {active?.name ?? range?.label ?? '12 months'}
        </text>
      </svg>

      <DonutLegend items={segments} hover={hover} onHoverChange={setHover} formatMoney={ctx.formatMoney} />
    </div>
  )
}
