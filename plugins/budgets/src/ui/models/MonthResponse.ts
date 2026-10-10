import type { AccountLine } from './AccountLine.js'
import type { MonthLine } from './MonthLine.js'
import type { MonthSummary } from './MonthSummary.js'
import type { Unbudgeted } from './Unbudgeted.js'

/** The response of `GET /month`: one month of budget with every figure derived from the ledger. */
export interface MonthResponse {
  /** The month as `YYYY-MM`. */
  readonly monthKey: string
  /** Inclusive first and last dates of the month, `YYYY-MM-DD`. */
  readonly period: { readonly start: string; readonly end: string }
  /** Today's date in the user's time zone, `YYYY-MM-DD`. */
  readonly today: string
  /** `true` when the month has no saved lines and is showing the previous month's as a preview. */
  readonly draft: boolean
  readonly lines: readonly MonthLine[]
  /**
   * Allowances measured against an account, kept out of `lines` and `summary`.
   * Absent from servers older than account lines.
   */
  readonly accountLines?: readonly AccountLine[]
  readonly unbudgeted: readonly Unbudgeted[]
  readonly summary: MonthSummary
}
