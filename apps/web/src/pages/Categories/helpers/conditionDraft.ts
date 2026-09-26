import { newUuid } from '../../../lib/newUuid.js'
import type { ConditionDraft } from '../state/ConditionDraft.js'

/**
 * Creates a blank condition row.
 *
 * @returns A draft of type `merchant_contains` with a fresh client-side key.
 */
export function newConditionDraft(): ConditionDraft {
  return {
    key: newUuid(),
    conditionType: 'merchant_contains',
    textValue: '',
    isCaseSensitive: false,
    direction: 'out',
    amountValue: '',
    amountMin: '',
    amountMax: '',
  }
}

/**
 * Reports whether a draft has been filled in enough to submit.
 *
 * This only avoids sending an obviously empty request on every keystroke. The
 * server remains the authority on validity, for example `amountMin <= amountMax`.
 *
 * @param d - The draft to check.
 * @returns `true` when the fields required by the draft's type are non-blank.
 */
export function isConditionComplete(d: ConditionDraft): boolean {
  switch (d.conditionType) {
    case 'merchant_exact':
    case 'merchant_contains':
    case 'description_contains':
      return d.textValue.trim() !== ''
    case 'amount_exact':
      return d.amountValue.trim() !== ''
    case 'amount_range':
      return d.amountMin.trim() !== '' || d.amountMax.trim() !== ''
  }
}

/**
 * Converts a draft into the request body accepted by `POST /category-rules`
 * and `POST /category-rules/preview`.
 *
 * @param d - The draft to convert.
 * @returns A discriminated union keyed on `conditionType`, carrying only the
 *   fields that type uses.
 */
export function toConditionBody(d: ConditionDraft): Record<string, unknown> {
  switch (d.conditionType) {
    case 'merchant_exact':
    case 'merchant_contains':
    case 'description_contains':
      return {
        conditionType: d.conditionType,
        textValue: d.textValue.trim(),
        isCaseSensitive: d.isCaseSensitive,
      }
    case 'amount_exact':
      return {
        conditionType: d.conditionType,
        direction: d.direction,
        amountValue: d.amountValue.trim(),
      }
    case 'amount_range':
      return {
        conditionType: d.conditionType,
        direction: d.direction,
        ...(d.amountMin.trim() !== '' ? { amountMin: d.amountMin.trim() } : {}),
        ...(d.amountMax.trim() !== '' ? { amountMax: d.amountMax.trim() } : {}),
      }
  }
}
