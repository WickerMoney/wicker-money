import type { LumpSumAllocation } from './LumpSum.js'

/** What a lump sum is created or replaced with. Amounts are already validated, normalised decimal strings. */
export interface LumpSumFields {
  readonly onDate: string
  readonly amount: string
  /** Defaults to empty. */
  readonly note?: string
  /** Defaults to none: the whole amount follows the strategy. */
  readonly allocations?: readonly LumpSumAllocation[]
}
