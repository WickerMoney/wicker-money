/**
 * The columns the category rule engine needs to test one condition.
 *
 * A rule carries an array of AND-ed conditions. Text and amount fields are
 * mutually exclusive per `condition_type`, mirroring the check constraint on
 * the rule-conditions table. Field names are snake_case to match the row shape
 * the host's query returns.
 */
export interface ConditionForMatching {
  readonly condition_type:
    | 'merchant_exact' | 'merchant_contains' | 'description_contains'
    | 'amount_exact' | 'amount_range'
  readonly text_value: string | null
  readonly is_case_sensitive: boolean
  readonly direction: 'in' | 'out' | null
  readonly amount_value: string | null
  readonly amount_min: string | null
  readonly amount_max: string | null
}
