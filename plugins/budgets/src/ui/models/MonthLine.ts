import type { Health } from '../../shared/index.js'

/** One budget line for one month, as returned by the month endpoint. */
export interface MonthLine {
  /** `null` for a draft line that has not been saved yet. */
  readonly id: string | null
  readonly categoryId: string
  readonly categoryName: string
  /** Decimal string. The amount the user planned to spend. */
  readonly planned: string
  /** Decimal string. Balance carried in from earlier months when the line rolls over. */
  readonly carriedIn: string
  /** Decimal string. `planned` plus `carriedIn`. */
  readonly available: string
  /** Decimal string. What has been spent in the category this month. */
  readonly spent: string
  /** Decimal string. `available` minus `spent`; negative when overspent. */
  readonly remaining: string
  /** `true` for a sinking-fund line whose leftover (or overspend) carries into the next month. */
  readonly rollover: boolean
  /** Fraction of `available` spent so far. Can exceed 1. */
  readonly used: number
  /** Fraction of the month that has elapsed. */
  readonly pace: number
  readonly health: Health
  readonly note: string | null
  /** `true` when the line is copied from the previous month and not yet saved. */
  readonly draft: boolean
}
