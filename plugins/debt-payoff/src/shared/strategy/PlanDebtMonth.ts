/** What happened to one debt in one month of a plan. */
export interface PlanDebtMonth {
  /** The debt. */
  readonly debtId: string
  /** Interest that accrued on the opening balance this month. */
  readonly interest: string
  /** Everything paid to this debt this month: its minimum plus any extra aimed at it. */
  readonly payment: string
  /** What is owed after the payment. `'0.0000'` in the month it is paid off. */
  readonly balance: string
}
