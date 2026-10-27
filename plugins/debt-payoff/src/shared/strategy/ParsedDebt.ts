import type { Compounding } from './Compounding.js'
import type { PromoInterestBase } from './PromoInterestBase.js'

/** A promotion after validation. */
export interface ParsedPromo {
  /** The promotional APR in units of 0.0001 of a percent. */
  readonly apr: bigint
  /** The promotion's last day, as given. */
  readonly endsOn: string
  /** How many plan months it covers: those whose payment is dated on or before `endsOn`. Zero if it ended before the first. */
  readonly months: number
  /** Whether interest is charged back to the start if the balance is not cleared in time. */
  readonly deferredInterest: boolean
  /** What that interest is charged on. */
  readonly base: PromoInterestBase
}

/** A {@link DebtInput} after validation: every amount an exact integer in units of 0.0001. */
export interface ParsedDebt {
  readonly id: string
  readonly name: string
  /** The balance in units of 0.0001. */
  readonly balance: bigint
  /** The APR percentage in units of 0.0001 of a percent. */
  readonly apr: bigint
  /** The minimum payment in units of 0.0001. */
  readonly minimum: bigint
  /** The earmark, in units of 0.0001: paid to this debt each month above its minimum. */
  readonly extra: bigint
  /** Position in the caller's list, which breaks ties between debts that are otherwise equal. */
  readonly position: number
  /** The first plan month a minimum is due; `1` for a debt that is not deferred. */
  readonly startMonth: number
  /** The day repayment begins, as given, or `null`. */
  readonly repaymentStartsOn: string | null
  /** The promotion, or `null`. */
  readonly promo: ParsedPromo | null
  /** How interest is worked out. */
  readonly compounding: Compounding
}
