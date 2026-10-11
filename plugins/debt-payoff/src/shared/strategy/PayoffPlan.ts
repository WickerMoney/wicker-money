import type { CapReason } from './CapReason.js'
import type { PlanDebt } from './PlanDebt.js'
import type { PlanMonth } from './PlanMonth.js'
import type { PlanTotals } from './PlanTotals.js'
import type { Strategy } from './Strategy.js'

/** A complete payoff plan: the schedule, the totals, and what it saves against paying only the minimums. */
export interface PayoffPlan {
  /** The strategy the plan used. */
  readonly strategy: Strategy
  /** The monthly extra, normalised to four decimal places. */
  readonly extraPayment: string
  /** The day the balances are as of. */
  readonly startDate: string
  /** Sum of the minimums of the debts with a balance, plus the extra: what is paid every month while any debt remains. */
  readonly monthlyBudget: string
  /** The order extra money is aimed in: debt ids, highest priority first. Debts that started at zero are not listed. */
  readonly order: readonly string[]
  /** Every debt: those with a balance in priority order, then those that started at zero in the order given. */
  readonly debts: readonly PlanDebt[]
  /** What was owed in total at the start. */
  readonly startingBalance: string
  /** Interest accrued over the schedule. */
  readonly totalInterest: string
  /** Everything paid over the schedule. */
  readonly totalPaid: string
  /** Months in the schedule; 0 if nothing is owed. */
  readonly months: number
  /** The date of the payment that clears the last debt, or `null` if the plan was capped. Equals the start date if nothing is owed. */
  readonly debtFreeDate: string | null
  /** Whether the plan stopped at a limit with something still owing. */
  readonly capped: boolean
  /** Why it stopped, or `null` when it did not. */
  readonly cappedReason: CapReason | null
  /** The longest schedule the engine builds, so a client can say "over 50 years" without hard-coding it. */
  readonly monthLimit: number
  /** The month-by-month schedule, empty if nothing is owed. */
  readonly schedule: readonly PlanMonth[]
  /**
   * The same debts if each were paid only its own minimum, with no extra and
   * nothing rolled over when another is paid off.
   */
  readonly minimumsOnly: PlanTotals
  /**
   * Months the plan finishes sooner than minimums only, or `null` if either
   * scenario was capped, since a capped one has no end to compare against.
   */
  readonly monthsSaved: number | null
  /** Interest the plan saves against minimums only, or `null` under the same condition. */
  readonly interestSaved: string | null
}
