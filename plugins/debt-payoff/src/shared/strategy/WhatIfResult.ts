import type { LumpSumOutcome } from './LumpSumOutcome.js'

/** The headline figures of one scenario. */
export interface WhatIfSummary {
  /** The date of the payment that clears the last debt, or `null` if the plan was capped. */
  readonly debtFreeDate: string | null
  /** Months in the schedule. */
  readonly months: number
  /** Interest accrued over the schedule. */
  readonly totalInterest: string
  /** Whether the plan stopped at a limit with something still owing. */
  readonly capped: boolean
}

/** What a candidate lump sum would change, worked out without saving anything. */
export interface WhatIfResult {
  /** The plan as it stands, with the lump sums already saved. */
  readonly current: WhatIfSummary
  /** The same plan with the candidate added. */
  readonly withLumpSum: WhatIfSummary
  /** Interest the candidate saves; `null` when either plan was capped, since a capped plan has no end to compare. */
  readonly interestSaved: string | null
  /** Months sooner the candidate finishes; `null` under the same condition. `0` when it makes no difference. */
  readonly monthsSaved: number | null
  /** What the plan did with the candidate: whether it was used, and how much of it. */
  readonly lumpSum: LumpSumOutcome
}
