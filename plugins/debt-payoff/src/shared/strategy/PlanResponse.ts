import type { PayoffPlan } from './PayoffPlan.js'

/** A debt left out of the plan, named so the page can say what the date leaves out. */
export interface ExcludedDebt {
  readonly id: string
  readonly name: string
}

/**
 * What `GET /plan` returns: the engine's plan plus the debts that were not in
 * it because the person turned "In plan" off. Archived debts are not listed;
 * they are retired, not left out.
 */
export interface PlanResponse extends PayoffPlan {
  /** Debts that are active but excluded from the plan, in the person's order. */
  readonly excludedDebts: readonly ExcludedDebt[]
}
