import { moneyToUnits } from '@wickermoney/plugin-sdk/money'

const DECIMAL = /^\d+(?:\.\d{1,4})?$/

/**
 * Checks typed text against the API's decimal rule.
 *
 * @param text - What was typed; surrounding spaces are ignored.
 * @param maxUnits - The largest allowed value in units of 0.0001.
 * @param messages - What to say for each way it can fail.
 * @returns A message, or `null` when the text is acceptable.
 */
export function decimalProblem(
  text: string,
  maxUnits: bigint,
  messages: { readonly empty: string; readonly notDecimal: string; readonly tooLarge: string },
): string | null {
  const value = text.trim()
  if (value === '') return messages.empty
  if (!DECIMAL.test(value)) return messages.notDecimal
  return moneyToUnits(value) > maxUnits ? messages.tooLarge : null
}
