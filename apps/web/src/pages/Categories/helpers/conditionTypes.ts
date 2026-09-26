import type { ConditionType } from '../../../models/index.js'

/** The condition types offered in the rule form, in display order. */
export const CONDITION_TYPES: readonly { value: ConditionType; label: string }[] = [
  { value: 'merchant_contains', label: 'Merchant contains' },
  { value: 'merchant_exact', label: 'Merchant is exactly' },
  { value: 'description_contains', label: 'Notes contain' },
  { value: 'amount_exact', label: 'Amount is exactly' },
  { value: 'amount_range', label: 'Amount is in a range' },
] as const
