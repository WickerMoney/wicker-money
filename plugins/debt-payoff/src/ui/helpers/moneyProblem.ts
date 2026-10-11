import { MAX_MONEY_UNITS } from '../../shared/index.js'
import { decimalProblem } from './decimalProblem.js'

/**
 * Why an amount cannot be saved, in the server's own words, or `null` when it can.
 *
 * Mirrors the API's rule so most mistakes are caught before a request: plain
 * digits with at most four decimal places, no commas or currency symbols.
 *
 * @param text - What was typed.
 * @returns A message for the field, or `null`.
 */
export function moneyProblem(text: string): string | null {
  return decimalProblem(text, MAX_MONEY_UNITS, {
    empty: 'Enter an amount.',
    notDecimal: 'Enter an amount in numbers with at most four decimal places, such as 250.00.',
    tooLarge: 'That amount is too large.',
  })
}
