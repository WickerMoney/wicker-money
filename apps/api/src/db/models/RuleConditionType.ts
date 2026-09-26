/** Every kind of test a rule condition can perform. */
export type RuleConditionType =
  | 'merchant_exact' | 'merchant_contains' | 'description_contains'
  | 'amount_exact' | 'amount_range'
