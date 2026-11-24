import { moneyToUnits } from '@wickermoney/plugin-sdk/money'
import { NO_FORM_ERRORS, hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import type { LumpSumDraft } from '../models/index.js'
import { dateProblem } from './dateProblem.js'
import { moneyProblem } from './moneyProblem.js'

const NOTE_LIMIT = 200

/** The field name a part aimed at one debt is shown on. */
export const partField = (debtId: string): string => `part:${debtId}`

/**
 * Checks a lump sum form with the API's own rules, so the person is told what
 * is wrong on the field it belongs to before anything is sent.
 *
 * The server still has the last word (it alone knows which debts are the
 * person's); anything it refuses that this misses comes back too.
 *
 * @param draft - The form as typed.
 * @param options - `withNote`: whether the form has a note (the what-if has none).
 * @returns The problems by field (`onDate`, `amount`, `note`, and `part:<debt id>` for a part), a form-level message when the parts add up to more than the amount, or no errors.
 */
export function checkLumpSumDraft(draft: LumpSumDraft, options: { readonly withNote?: boolean } = {}): FormErrors {
  const fields: Record<string, string> = {}
  let form: string | null = null
  const date = dateProblem(draft.onDate)
  if (date !== null) fields['onDate'] = draft.onDate.trim() === '' ? 'Enter the date.' : date
  let total: bigint | null = null
  const amount = moneyProblem(draft.amount)
  if (amount !== null) fields['amount'] = amount
  else if (moneyToUnits(draft.amount.trim()) === 0n) fields['amount'] = 'Enter an amount more than zero.'
  else total = moneyToUnits(draft.amount.trim())
  if (options.withNote !== false && draft.note.trim().length > NOTE_LIMIT) fields['note'] = `Use ${NOTE_LIMIT} characters or fewer.`

  let parts = 0n
  for (const [debtId, text] of Object.entries(draft.allocations)) {
    if (text.trim() === '') continue
    const problem = moneyProblem(text)
    if (problem !== null) fields[partField(debtId)] = problem
    else if (moneyToUnits(text.trim()) === 0n) fields[partField(debtId)] = 'Enter an amount more than zero, or leave it blank.'
    else parts += moneyToUnits(text.trim())
  }
  if (total !== null && parts > total && Object.keys(fields).every((f) => !f.startsWith('part:'))) {
    form = 'The amounts for single debts add up to more than the lump sum.'
  }
  const errors: FormErrors = { fields, form }
  return hasFormErrors(errors) ? errors : NO_FORM_ERRORS
}
