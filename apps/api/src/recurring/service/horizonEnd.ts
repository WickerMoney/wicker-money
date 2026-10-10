import { addDays, addMonths } from '@wickermoney/plugin-sdk/date'
import type { ForecastHorizon } from './FORECAST_HORIZONS.js'

/**
 * The last day a forecast covers, inclusive.
 *
 * Day counts are counted from today, so `30d` ends 30 days after today and
 * covers 30 projected days starting tomorrow. `eoy` is December 31 of the
 * year tomorrow falls in, so on December 31 it means the whole of next year
 * rather than an empty chart.
 *
 * @param today - The user's today, `YYYY-MM-DD`.
 * @param horizon - How far to look.
 * @returns The last day included, `YYYY-MM-DD`.
 */
export function horizonEnd(today: string, horizon: ForecastHorizon): string {
  switch (horizon) {
    case '30d': return addDays(today, 30)
    case '60d': return addDays(today, 60)
    case '90d': return addDays(today, 90)
    case '6m': return addMonths(today, 6)
    case 'eoy': return `${addDays(today, 1).slice(0, 4)}-12-31`
  }
}
