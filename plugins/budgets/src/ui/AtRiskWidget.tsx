import { useEffect, useState, type CSSProperties } from 'react'
import type { PluginWidgetProps } from '@wickermoney/plugin-sdk'
import { isZeroMoney } from '@wickermoney/plugin-sdk/money'
import { Button, EmptyState, Spinner } from '@wickermoney/ui-kit'
import './styles.js'
import { BUDGETS_API_BASE } from '../server/constants.js'
import { LineBar } from './components/LineBar.js'
import { useTileFlow } from './hooks/useTileFlow.js'
import { BUDGETS_PAGE_PATH } from './helpers/budgetsPagePath.js'
import { HEALTH_CLASS } from './helpers/healthClass.js'
import type { AtRiskResponse } from './models/index.js'

/** Gap between tiles and narrowest tile, in px. Keep in step with `.budw__tiles` in budgets.css. */
const TILE_GAP = 10
const MIN_TILE_WIDTH = 230

/**
 * A dashboard widget breaking the month's budget down line by line, trouble first.
 *
 * It sits beside "Until payday" at half width, which is room for about six
 * tiles. Lines that are over, or spending faster than the month is arriving,
 * lead, because seeing those today rather than on the 30th is what changes
 * anything; the rest follow by how much of their budget is gone, so the half
 * tile reads as the month's breakdown rather than an alarm list with gaps.
 *
 * The tiles are one column that fills the card's height, then spills into a
 * second column, and so on as far as the card is wide: a card stretched beside
 * a tall neighbour uses its own height instead of leaving it blank. Narrow, it
 * is a plain stack.
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

  // Called ahead of the early returns below, which would otherwise change the
  // number of hooks between renders. The count comes from the loaded data.
  const tileCount = data === null ? 0 : (data.breakdown ?? data.lines).length
  const { viewportRef, tilesRef, flow } = useTileFlow(tileCount, TILE_GAP, MIN_TILE_WIDTH)

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

  // Servers from before the breakdown send only the ranked lines.
  const tiles = data.breakdown ?? data.lines
  if (tiles.length === 0) {
    return (
      <p className="budw__ok">
        All {data.total} budget lines are on pace. Nothing needs attention today.
      </p>
    )
  }

  const total = data.total ?? tiles.length
  const attention = data.lines.length

  return (
    <div className="budw">
      <div
        ref={viewportRef}
        className={`budw__viewport${flow !== null ? ' is-flowing' : ''}`}
        style={flow !== null ? ({ '--budw-min': `${flow.minHeight}px` } as CSSProperties) : undefined}
      >
        <div
          ref={tilesRef}
          className="budw__tiles"
          style={flow !== null
            ? ({ '--budw-cols': flow.columns, '--budw-rows': flow.rows } as CSSProperties)
            : undefined}
        >
          {tiles.map((line) => (
            // One tile per line, in the same shape as the marketing site's
            // budget tile: what the line is, spent of available, and the bar.
            <div className={`budw__tile ${HEALTH_CLASS[line.health]}`} key={line.categoryId}>
              <div className="budw__tile-head">
                <p className="budw__tile-label">{line.categoryName}</p>
                <span className={`budw__amount${line.health === 'over' ? ' is-over' : ''}`}>
                  {line.health === 'over'
                    ? `${ctx.formatMoney(line.remaining.replace('-', ''))} over`
                    : `${ctx.formatMoney(line.remaining)} left`}
                </span>
              </div>
              <p className="budw__tile-value">
                {ctx.formatMoney(line.spent)} <span className="budw__tile-sub">of {ctx.formatMoney(line.available)}</span>
              </p>
              <LineBar
                slim
                used={line.used}
                health={line.health}
                monthKey={data.monthKey}
                today={data.today}
                elapsed={line.elapsed}
                label={`${line.categoryName}: ${ctx.formatMoney(line.spent)} of ${ctx.formatMoney(line.available)}`}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="budw__foot">
        <p>
          {attention === 0
            ? `All ${total} budget lines are on pace.`
            : `${attention} of ${total} lines need attention.`}
          {data.summary !== undefined && !isZeroMoney(data.summary.available) &&
            ` ${ctx.formatMoney(data.summary.spent)} of ${ctx.formatMoney(data.summary.available)} spent.`}
          {' '}The mark on each bar is today.
        </p>
        {total > tiles.length && (
          <Button onClick={() => ctx.navigate(BUDGETS_PAGE_PATH)}>
            All {total} lines
          </Button>
        )}
      </div>
    </div>
  )
}
