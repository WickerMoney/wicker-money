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
  /** Position in the caller's list, which breaks ties between debts that are otherwise equal. */
  readonly position: number
}
