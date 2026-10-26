/** A debt being typed into the form. Every field is text, as typed. */
export interface DebtDraft {
  readonly name: string
  readonly balance: string
  readonly apr: string
  readonly minimumPayment: string
  /** The linked account's id, or `''` for none. */
  readonly accountId: string
  readonly archived: boolean
  /** Whether the debt is part of the payoff plan. */
  readonly included: boolean
  /** The earmark as typed; blank means none. */
  readonly extraPayment: string
  /** The day repayment begins, `YYYY-MM-DD`, or `''` if it has begun. */
  readonly repaymentStartsOn: string
  /** The promotional rate as typed; blank means no promotion. */
  readonly promoApr: string
  /** The promotion's last day, `YYYY-MM-DD`, or `''`. */
  readonly promoEndsOn: string
  readonly promoDeferredInterest: boolean
  readonly promoInterestBase: 'original' | 'declining'
  readonly compounding: 'monthly' | 'daily' | 'daily_simple'
}
