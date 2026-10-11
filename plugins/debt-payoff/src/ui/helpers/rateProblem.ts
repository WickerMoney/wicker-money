import { MAX_APR_UNITS } from '../../shared/index.js'
import { decimalProblem } from './decimalProblem.js'

/**
 * Why an interest rate cannot be saved, or `null` when it can.
 *
 * @param text - What was typed, as a percentage such as `24.99`.
 * @returns A message for the field, or `null`.
 */
export function rateProblem(text: string): string | null {
  return decimalProblem(text, MAX_APR_UNITS, {
    empty: 'Enter the rate as a percentage, such as 24.99. Use 0 for no interest.',
    notDecimal: 'Enter the rate as a percentage with at most four decimal places, such as 24.99.',
    tooLarge: 'The rate cannot be more than 999.9999%.',
  })
}
