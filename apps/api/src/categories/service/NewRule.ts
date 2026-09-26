import type { ConditionInput } from './ConditionInput.js'

/** A rule to create, or to preview before creating. */
export interface NewRule {
  readonly categoryId: string
  readonly priority: number
  /** All conditions must match (AND). At least one is required. */
  readonly conditions: readonly ConditionInput[]
  /** Also apply the rule to transactions that already have a non-manual category. */
  readonly applyToExisting: boolean
}
