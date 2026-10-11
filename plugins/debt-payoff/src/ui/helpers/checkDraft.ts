import { NO_FORM_ERRORS, hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import type { DebtDraft } from '../models/index.js'
import { moneyProblem } from './moneyProblem.js'
import { rateProblem } from './rateProblem.js'

const NAME_LIMIT = 100

/**
 * Checks a debt form with the API's own rules, so the person is told what is
 * wrong on the field it belongs to before anything is sent.
 *
 * The server still has the last word; anything it refuses that this misses
 * comes back on its field too.
 *
 * @param draft - The form as typed.
 * @returns The problems by field name (`name`, `balance`, `apr`, `minimumPayment`), or no errors.
 */
export function checkDraft(draft: DebtDraft): FormErrors {
  const fields: Record<string, string> = {}
  const name = draft.name.trim()
  if (name === '') fields['name'] = 'Enter a name.'
  else if (name.length > NAME_LIMIT) fields['name'] = `Use ${NAME_LIMIT} characters or fewer.`
  const balance = moneyProblem(draft.balance)
  if (balance !== null) fields['balance'] = balance
  const apr = rateProblem(draft.apr)
  if (apr !== null) fields['apr'] = apr
  const minimum = moneyProblem(draft.minimumPayment)
  if (minimum !== null) fields['minimumPayment'] = minimum
  const errors: FormErrors = { fields, form: null }
  return hasFormErrors(errors) ? errors : NO_FORM_ERRORS
}
