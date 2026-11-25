import type { LumpSumInput } from './LumpSumInput.js'
import type { Strategy } from './Strategy.js'

/** What a plan is asked to do. */
export interface PlanOptions {
  /** Where the money above the minimums goes first. */
  readonly strategy: Strategy
  /** Paid every month on top of the minimums, as a decimal string. `'0'` is allowed. */
  readonly extraPayment: string
  /**
   * The day the balances are as of, `YYYY-MM-DD`. Month 1 is the month that
   * follows it, so a balance read on 2026-10-10 has its first payment dated
   * 2026-11-10. Passed in rather than read from a clock, so the plan is a pure
   * function of its input.
   */
  readonly startDate: string
  /**
   * One-off payments to apply on their dates (see {@link LumpSumInput}). Left
   * out or empty, the plan is exactly what it is without the feature and has no
   * `lumpSums` field. The minimums-only comparison never includes them.
   */
  readonly lumpSums?: readonly LumpSumInput[]
}
