import type { Health } from '../../shared/index.js'

/**
 * One account allowance for one month, as returned in the month response's
 * `accountLines`: the same figures as a category line, for the money that left
 * one account.
 */
export interface AccountLine {
  /** `null` for a draft line that has not been saved yet. */
  readonly id: string | null
  readonly accountId: string
  readonly accountName: string
  /** `account:<accountId>`, the key the shared line shape uses in place of a category id. */
  readonly categoryId: string
  /** What the tile calls it, such as `Joint Checking spending`. */
  readonly categoryName: string
  /** Decimal string. The allowance for the month. */
  readonly planned: string
  /** Decimal string. What was left (or overdrawn, negative) coming in from earlier months. */
  readonly carriedIn: string
  /** Decimal string. `planned` plus `carriedIn`. */
  readonly available: string
  /** Decimal string. What left the account this month, not counting the excluded categories. */
  readonly spent: string
  /** Decimal string. `available` minus `spent`; negative when overspent. */
  readonly remaining: string
  readonly rollover: boolean
  readonly used: number
  readonly pace: number
  readonly elapsed?: number
  /** Judged by total, never by pace, so only `over`, `unused` or `on-track`. */
  readonly health: Health
  readonly excludedCategoryIds: readonly string[]
  readonly note: string | null
  /** `true` when the line is copied from the previous month and not yet saved. */
  readonly draft: boolean
}
