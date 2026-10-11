import { MAX_APR_UNITS } from '../../../shared/index.js'
import { decimalText } from './decimalText.js'

/**
 * An annual percentage rate as a request carries it: text for a percentage,
 * so `'24.99'` is 24.99%. Up to four decimal places and no more than 999.9999,
 * returned as `'24.9900'`.
 */
export const aprField = decimalText(MAX_APR_UNITS, {
  notText: 'Send the rate as text, such as "24.99" for 24.99%.',
  notDecimal: 'Enter the rate as a percentage with at most four decimal places, such as 24.99.',
  tooLarge: 'The rate cannot be more than 999.9999%.',
})
