/**
 * How far a forecast looks ahead: 30, 60 or 90 days, six months, or to the end
 * of the year. The server turns one into dates against the user's today, so a
 * client never needs its own idea of what today is.
 */
export const FORECAST_HORIZONS = ['30d', '60d', '90d', '6m', 'eoy'] as const

/** One of {@link FORECAST_HORIZONS}. */
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number]

/** The horizon a forecast uses when the caller names none: long enough to show one quarterly bill. */
export const DEFAULT_FORECAST_HORIZON: ForecastHorizon = '90d'
