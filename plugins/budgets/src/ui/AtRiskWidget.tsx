import { useEffect, useState } from 'react'
import type { PluginWidgetProps } from '@wickermoney/plugin-sdk'
import { EmptyState, Spinner } from '@wickermoney/ui-kit'
import './styles.js'
import { BUDGETS_API_BASE } from '../server/constants.js'
import { LineBar } from './components/LineBar.js'
import type { AtRiskResponse } from './models/index.js'

/**
 * A dashboard widget listing the budget lines worth acting on, worst first.
 *
 * A tile has room for about four rows, so the question is which four. Not the
 * biggest budgets: a large mortgage line at 50% on the 15th is doing exactly what
 * it should. Not everything either, since that is the full page. What fits is
 * the short list of lines that are over, or spending faster than the month is
 * arriving, which is the only set where seeing it today rather than on the 30th
 * changes anything.
 *
 * Ranking and health come from the plugin's shared module, which the page and
 * the server also use, so the widget cannot call a line at-risk that the page
 * calls fine.
 *
 * Exposed to the host as a default export.
 */
export default function AtRiskWidget({ ctx }: PluginWidgetProps) {
  const [data, setData] = useState<AtRiskResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { api } = ctx
  const { timezone } = ctx.session

  useEffect(() => {
    // Aborting on cleanup means a slow response for an earlier request (a
    // different zone, or an unmount) is discarded rather than overwriting a
    // newer one.
    const controller = new AbortController()
    const { signal } = controller
    api
      .get<AtRiskResponse>(`${BUDGETS_API_BASE}/at-risk?tz=${encodeURIComponent(timezone)}`, { signal })
      .then((r) => {
        if (signal.aborted) return
        setData(r)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load budgets.')
      })
    return () => controller.abort()
  }, [api, timezone])

  if (error !== null) return <EmptyState title="Budgets unavailable" hint={error} />
  if (data === null) return <Spinner label="Loading budgets" />

  if (!data.planned) {
    return (
      <EmptyState
        title="No budget this month"
        hint="Set one up on the Budgets page and this will show what needs attention."
      />
    )
  }

  if (data.lines.length === 0) {
    return (
      <p className="budw__ok">
        All {data.total} budget lines are on pace. Nothing needs attention today.
      </p>
    )
  }

  return (
    <div className="budw">
      {data.lines.map((line) => (
        <div className="budw__row" key={line.categoryId}>
          <div className="budw__head">
            <span className="budw__name">{line.categoryName}</span>
            <span className={`budw__amount${line.health === 'over' ? ' is-over' : ''}`}>
              {line.health === 'over'
                ? `${ctx.formatMoney(line.remaining.replace('-', ''))} over`
                : `${ctx.formatMoney(line.remaining)} left`}
            </span>
          </div>
          <LineBar
            used={line.used}
            health={line.health}
            monthKey={data.monthKey}
            today={data.today}
            label={`${line.categoryName}: ${ctx.formatMoney(line.spent)} of ${ctx.formatMoney(line.available)}`}
          />
        </div>
      ))}
      <p className="budw__foot">
        {data.lines.length} of {data.total} lines need attention.
        {' '}The mark on each bar is today.
      </p>
    </div>
  )
}
