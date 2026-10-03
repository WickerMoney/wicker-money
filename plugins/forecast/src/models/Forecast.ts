/** How far the forecast looks ahead. The server resolves it against the user's today. */
export type ForecastHorizon = '30d' | '60d' | '90d' | '6m' | 'eoy'

/** An account the forecast can be drawn for. */
export interface ForecastAccountOption {
  readonly accountId: string
  readonly name: string
  readonly accountType: string
}

/** The account the forecast is drawn for. */
export interface ForecastAccount extends ForecastAccountOption {
  /** Today's actual balance; the projection starts from it. */
  readonly balance: string
  readonly buffer: string
  /** Checking or savings: overdraft and buffer apply. False for cards and loans. */
  readonly cash: boolean
}

/** One projected day. */
export interface ForecastDay {
  readonly date: string
  /** End-of-day balance. */
  readonly balance: string
  /** Lowest point that day, outflows before inflows. */
  readonly low: string
}

/** Where the balance first crosses a line. */
export interface ForecastBreach {
  readonly date: string
  readonly balance: string
}

/** The stat tiles. Overdraft and buffer fields are `null` for cards and loans. */
export interface ForecastStats {
  readonly start: string
  readonly end: string
  readonly lowest: { readonly date: string; readonly balance: string }
  readonly daysBelowZero: number | null
  readonly daysBelowBuffer: number | null
  readonly firstBelowZero: ForecastBreach | null
  readonly firstBelowBuffer: ForecastBreach | null
}

/** One occurrence that moves the account. */
export interface ForecastEntry {
  readonly itemId: string
  readonly date: string
  readonly name: string
  readonly kind: 'income' | 'bill' | 'debt_payment' | 'transfer'
  /** What it does to this account: negative leaves, positive arrives. */
  readonly amount: string
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
}

/** `GET /core/recurring-items/forecast`: everything computed on the server. */
export interface ForecastResponse {
  readonly today: string
  readonly horizon: ForecastHorizon
  readonly window: { readonly from: string; readonly through: string }
  readonly accounts: readonly ForecastAccountOption[]
  readonly account: ForecastAccount | null
  readonly days: readonly ForecastDay[]
  readonly stats: ForecastStats | null
  readonly entries: readonly ForecastEntry[]
  readonly hasItems: boolean
}

/** What the page's data hook returns. */
export interface ForecastState {
  /** The latest answer; kept while a new account or horizon loads, so the page does not blank. */
  readonly data: ForecastResponse | null
  readonly loading: boolean
  readonly error: string | null
}
