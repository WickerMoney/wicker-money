/** The ways a rule condition can test a transaction. */
export type ConditionType =
  | 'merchant_exact'
  | 'merchant_contains'
  | 'description_contains'
  | 'amount_exact'
  | 'amount_range'
