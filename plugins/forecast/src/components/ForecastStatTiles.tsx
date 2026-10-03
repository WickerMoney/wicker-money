import { Stat } from '@wickermoney/ui-kit'
import { isPositiveAmount } from '../helpers/isPositiveAmount.js'
import type { ForecastAccount, ForecastStats } from '../models/index.js'

/** Props for {@link ForecastStatTiles}. */
export interface ForecastStatTilesProps {
  readonly account: ForecastAccount
  readonly stats: ForecastStats
  readonly through: string
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * The figures under the chart: where the balance starts and ends, its lowest
 * point, and for checking and savings how many days it spends below zero and
 * below the buffer. Day counts read each day's low, the same as the chart's
 * dips and the breach banner.
 */
export function ForecastStatTiles({ account, stats, through, formatMoney, formatDate }: ForecastStatTilesProps) {
  return (
    <div className="fc-stats">
      <Stat label="Today" value={formatMoney(stats.start)} />
      <Stat label={`On ${formatDate(through)}`} value={formatMoney(stats.end)} tone={account.cash ? 'auto' : 'neutral'} />
      <Stat label={`Lowest, ${formatDate(stats.lowest.date)}`} value={formatMoney(stats.lowest.balance)} tone={account.cash ? 'auto' : 'neutral'} />
      {stats.daysBelowZero !== null ? (
        <Stat
          label="Days below zero"
          value={String(stats.daysBelowZero)}
          tone={stats.daysBelowZero > 0 ? 'negative' : 'neutral'}
        />
      ) : null}
      {stats.daysBelowBuffer !== null && isPositiveAmount(account.buffer) ? (
        <Stat
          label={`Days below ${formatMoney(account.buffer)} buffer`}
          value={String(stats.daysBelowBuffer)}
          tone={stats.daysBelowBuffer > 0 ? 'negative' : 'neutral'}
        />
      ) : null}
    </div>
  )
}
