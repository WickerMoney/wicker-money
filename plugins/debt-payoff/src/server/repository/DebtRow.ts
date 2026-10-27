import type { Compounding, PromoInterestBase } from '../../shared/index.js'

/** A debt as stored. Numeric columns are read as text so they never pass through a JavaScript number. */
export interface DebtRow {
  id: string
  name: string
  balance: string
  apr: string
  minimum_payment: string
  account_id: string | null
  sort_order: number
  archived: boolean
  included: boolean
  extra_payment: string
  /** `YYYY-MM-DD` for a deferred loan, else `null`. */
  repayment_starts_on: string | null
  /** The promotional APR percentage, or `null` for none. */
  promo_apr: string | null
  /** The promotion's last day, `YYYY-MM-DD`, or `null`. */
  promo_ends_on: string | null
  promo_deferred_interest: boolean
  promo_interest_base: PromoInterestBase
  compounding: Compounding
}
