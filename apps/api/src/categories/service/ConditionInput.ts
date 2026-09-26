import type { AmountDirection } from '../../db/models/index.js'

/** A text condition: matches merchant or description text. */
export interface TextConditionInput {
  readonly conditionType: 'merchant_exact' | 'merchant_contains' | 'description_contains'
  readonly textValue: string
  readonly isCaseSensitive: boolean
}

/** An exact-amount condition, expressed as a positive magnitude and a direction. */
export interface AmountExactConditionInput {
  readonly conditionType: 'amount_exact'
  readonly direction: AmountDirection
  readonly amountValue: string
}

/** A ranged amount condition. Either bound may be absent. */
export interface AmountRangeConditionInput {
  readonly conditionType: 'amount_range'
  readonly direction: AmountDirection
  readonly amountMin?: string | null | undefined
  readonly amountMax?: string | null | undefined
}

/** Any one rule condition. */
export type ConditionInput = TextConditionInput | AmountExactConditionInput | AmountRangeConditionInput
