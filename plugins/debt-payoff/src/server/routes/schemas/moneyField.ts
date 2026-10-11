import { MAX_MONEY_UNITS } from '../../../shared/index.js'
import { decimalText } from './decimalText.js'

/**
 * An amount of money as a request carries it: a string, never a JSON number.
 *
 * Accepts `'10'`, `'10.5'` and `'10.5000'` and no more than four decimal
 * places, then returns it in the storage form, `'10.5000'`. A number is
 * refused with a message that says to send text, because `0.1 + 0.2` is how
 * money goes wrong.
 */
export const moneyField = decimalText(MAX_MONEY_UNITS, {
  notText: 'Send amounts as text, such as "250.00"; a JSON number can lose cents.',
  notDecimal: 'Enter an amount in numbers with at most four decimal places, such as 250.00.',
  tooLarge: 'That amount is too large.',
})
