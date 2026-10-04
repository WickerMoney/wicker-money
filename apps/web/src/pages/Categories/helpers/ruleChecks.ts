import { compareMoney } from '@wickermoney/plugin-sdk/money'
import { checkMoney, checkText, fieldErrors, isZeroAmount } from '../../../lib/fieldChecks.js'
import type { FormErrors } from '@wickermoney/ui-kit'
import type { ConditionDraft } from '../state/ConditionDraft.js'

/** "At least" must be positive; zero is read as "no minimum" before this is checked. */
export const MIN_NOT_POSITIVE = 'Must be more than 0. Leave it empty for no minimum.'
/** "At most" must be positive: amounts are magnitudes, so at most 0 could match nothing. */
export const MAX_NOT_POSITIVE = 'Must be more than 0. Leave it empty for no maximum.'
/** A range needs one bound or the other. */
export const RANGE_NEEDS_A_BOUND = 'Set a minimum, a maximum, or both.'

/**
 * The form field a condition's input is stored under: the row's client key
 * plus the field name, so an error follows its row when another is removed.
 *
 * @param draft - The condition row.
 * @param field - The field in that row, such as `amountMin`.
 * @returns The form field name.
 */
export function conditionField(draft: ConditionDraft, field: string): string {
  return `${draft.key}.${field}`
}

/**
 * The typed "At least", with zero read as no minimum.
 *
 * "At least 0" matches every amount on that side, which is what an empty
 * minimum already means, so it is treated as empty instead of refused. The
 * field's hint says so.
 *
 * @param draft - The condition row.
 * @returns The minimum to send, or `''` for none.
 */
export function effectiveMin(draft: ConditionDraft): string {
  const min = draft.amountMin.trim()
  return isZeroAmount(min) ? '' : min
}

/**
 * Checks a rule before it is previewed or saved, with the API's rules.
 *
 * @param priority - The priority as typed; blank means 0.
 * @param conditions - The condition rows.
 * @returns Errors keyed by `priority` and {@link conditionField} names.
 */
export function checkRule(priority: string, conditions: readonly ConditionDraft[]): FormErrors {
  const checks: Record<string, string | undefined> = {
    priority: /^\s*-?\d*\s*$/.test(priority) ? undefined : 'Must be a whole number.',
  }
  for (const c of conditions) {
    switch (c.conditionType) {
      case 'merchant_exact':
      case 'merchant_contains':
      case 'description_contains':
        checks[conditionField(c, 'textValue')] = checkText(c.textValue, 500)
        break
      case 'amount_exact':
        checks[conditionField(c, 'amountValue')] = checkMoney(c.amountValue, 'positive')
        break
      case 'amount_range': {
        const min = effectiveMin(c)
        const max = c.amountMax.trim()
        if (min === '' && max === '') {
          checks[conditionField(c, 'amountMin')] = RANGE_NEEDS_A_BOUND
          break
        }
        const minProblem = min === '' ? undefined : checkMoney(min, 'positive', MIN_NOT_POSITIVE)
        const maxProblem = max === '' ? undefined : checkMoney(max, 'positive', MAX_NOT_POSITIVE)
        checks[conditionField(c, 'amountMin')] = minProblem
        checks[conditionField(c, 'amountMax')] = maxProblem
          ?? (min !== '' && max !== '' && minProblem === undefined && compareMoney(min, max) > 0
            ? 'Cannot be less than the minimum.'
            : undefined)
        break
      }
    }
  }
  return fieldErrors(checks)
}
