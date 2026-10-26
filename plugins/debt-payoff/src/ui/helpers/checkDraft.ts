import { NO_FORM_ERRORS, hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import type { DebtDraft } from '../models/index.js'
import { dateProblem } from './dateProblem.js'
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
 * @returns The problems by field name (`name`, `balance`, `apr`, `minimumPayment`, `extraPayment`, `repaymentStartsOn`, `promoApr`, `promoEndsOn`), or no errors.
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
  // An earmark is optional; blank means none.
  if (draft.extraPayment.trim() !== '') {
    const earmark = moneyProblem(draft.extraPayment)
    if (earmark !== null) fields['extraPayment'] = earmark
  }
  // Timing and promotion are optional; a date or rate left blank means none.
  const startsOn = draft.repaymentStartsOn.trim()
  if (startsOn !== '') {
    const problem = dateProblem(startsOn)
    if (problem !== null) fields['repaymentStartsOn'] = problem
  }
  const promoRate = draft.promoApr.trim()
  const promoEnd = draft.promoEndsOn.trim()
  if (promoRate !== '') {
    const problem = rateProblem(promoRate)
    if (problem !== null) fields['promoApr'] = problem
    if (promoEnd === '') fields['promoEndsOn'] = 'Enter the day the promotional rate ends.'
  }
  if (promoEnd !== '') {
    const problem = dateProblem(promoEnd)
    if (problem !== null) fields['promoEndsOn'] = problem
    if (promoRate === '') fields['promoApr'] = 'Enter the promotional rate, such as 0 for no interest.'
  }
  const errors: FormErrors = { fields, form: null }
  return hasFormErrors(errors) ? errors : NO_FORM_ERRORS
}
