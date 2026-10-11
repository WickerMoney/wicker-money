import { moneyToUnits, unitsToMoney } from '@wickermoney/plugin-sdk/money'
import { z } from 'zod'

/** Digits with an optional fraction of at most four places: no sign, separator, exponent or symbol. */
const DECIMAL = /^\d+(?:\.\d{1,4})?$/

/** What {@link decimalText} says when a value is refused. */
interface DecimalMessages {
  /** For a value that is not text (a JSON number, `null`, an object). */
  readonly notText: string
  /** For text that is not a plain decimal with at most four places. */
  readonly notDecimal: string
  /** For a decimal above the maximum. */
  readonly tooLarge: string
}

/**
 * A non-negative decimal sent as text, validated exactly and returned in the
 * storage form with four decimal places (`'10.5'` becomes `'10.5000'`).
 *
 * One transform does the whole check, in order, so the exact parser only ever
 * sees text that already matched the pattern; zod runs every check on a value
 * even after an earlier one has failed, and the exact parser throws on bad
 * input.
 *
 * @param maxUnits - The largest value allowed, in units of 0.0001.
 * @param messages - What to say for each way of being refused.
 * @returns The schema.
 */
export function decimalText(maxUnits: bigint, messages: DecimalMessages) {
  return z
    .string({ error: messages.notText })
    .trim()
    .transform((value, ctx) => {
      if (!DECIMAL.test(value)) {
        ctx.addIssue({ code: 'custom', message: messages.notDecimal })
        return z.NEVER
      }
      const units = moneyToUnits(value)
      if (units > maxUnits) {
        ctx.addIssue({ code: 'custom', message: messages.tooLarge })
        return z.NEVER
      }
      return unitsToMoney(units)
    })
}
