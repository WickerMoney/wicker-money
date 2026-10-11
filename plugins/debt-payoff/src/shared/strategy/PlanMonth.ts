import type { PlanDebtMonth } from './PlanDebtMonth.js'

/**
 * One month of a plan.
 *
 * Interest accrues over the month on the opening balance and the payment is
 * made at its end, so `date` is the payment date.
 */
export interface PlanMonth {
  /** 1 for the first month after the start date. */
  readonly month: number
  /** The payment date, `YYYY-MM-DD`: the start date plus `month` months, clamped to the end of a short month. */
  readonly date: string
  /** Interest accrued across all debts this month. */
  readonly interest: string
  /** Paid across all debts this month. */
  readonly payment: string
  /** Owed across all debts after this month's payments. */
  readonly balance: string
  /** One entry per debt that still had a balance when the month began, highest priority first. */
  readonly debts: readonly PlanDebtMonth[]
}
