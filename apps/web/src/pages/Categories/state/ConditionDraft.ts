import type { ConditionType } from '../../../models/index.js'

/**
 * One condition row as it is being edited in the "Add a rule" form.
 *
 * Every field is present regardless of the chosen type; only the fields that
 * type uses are sent to the server when the rule is saved. Keeping them all in
 * one flat shape means switching the type in the picker does not discard what
 * was typed into the others.
 */
export interface ConditionDraft {
  /** Client-side identity for React keys. Never sent to the server. */
  readonly key: string
  /** Which test the row applies. */
  conditionType: ConditionType
  /** Text to match, for the text condition types. */
  textValue: string
  /** Whether text matching respects letter case. */
  isCaseSensitive: boolean
  /**
   * Which side of zero the amount applies to. Amounts are entered as a
   * magnitude plus a direction, never as a signed number: a 375.00 cheque is
   * `{ direction: 'out', amountValue: '375.00' }`, not `'-375.00'`.
   */
  direction: 'in' | 'out'
  /** Exact amount, as typed. */
  amountValue: string
  /** Lower bound of an amount range, as typed. */
  amountMin: string
  /** Upper bound of an amount range, as typed. */
  amountMax: string
}
