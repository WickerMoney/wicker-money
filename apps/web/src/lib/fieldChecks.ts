import { moneyToUnits } from '@wickermoney/plugin-sdk/money'
import type { FormErrors } from '@wickermoney/ui-kit'

/**
 * Checks a form runs in the browser before it submits, with the API's rules
 * and the API's wording, so a bad value is caught next to its field without
 * a round trip and the message does not change when the server says it.
 *
 * Money goes through `@wickermoney/plugin-sdk/money`, whose parse refuses a
 * fifth decimal place the same way the API does, rather than a second copy of
 * the rule. Each check returns a sentence, or `undefined` when the value is
 * fine.
 */

/** What the API says about an amount it cannot store. */
export const MONEY_FORMAT_MESSAGE = 'Enter an amount like 12.50, with no more than 4 decimal places.'
/** What the API says about a blank required field. */
export const REQUIRED_MESSAGE = 'This cannot be empty.'
/** What the API says about a zero or negative amount where only a positive one makes sense. */
export const POSITIVE_MESSAGE = 'Must be more than 0.'

/** The most integer digits `numeric(19,4)` holds; the API refuses more. */
const MAX_WHOLE_DIGITS = 15

/** Which amounts a field accepts. */
export type MoneySign = 'any' | 'positive' | 'nonNegative'

/**
 * Checks a typed amount.
 *
 * @param text - The amount as typed. Surrounding spaces are ignored.
 * @param sign - Which amounts are allowed.
 * @param notPositive - What to say about zero (or less) for `'positive'`.
 * @returns The problem, or `undefined`.
 */
export function checkMoney(text: string, sign: MoneySign = 'any', notPositive = POSITIVE_MESSAGE): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return REQUIRED_MESSAGE
  let units: bigint
  try {
    units = moneyToUnits(trimmed)
  } catch {
    return MONEY_FORMAT_MESSAGE
  }
  const whole = trimmed.replace(/^-/, '').split('.')[0] ?? ''
  if (whole.length > MAX_WHOLE_DIGITS) return MONEY_FORMAT_MESSAGE
  if (sign === 'positive' && units <= 0n) return notPositive
  if (sign === 'nonNegative' && units < 0n) return 'Cannot be negative.'
  return undefined
}

/**
 * Checks that a typed amount is exactly zero, for fields where zero means
 * "none" (a rule's "At least 0" is the same as no minimum).
 *
 * @param text - The amount as typed.
 * @returns `true` for any spelling of zero (`0`, `0.00`, `-0`).
 */
export function isZeroAmount(text: string): boolean {
  try {
    return moneyToUnits(text.trim()) === 0n
  } catch {
    return false
  }
}

/**
 * Checks a required text field.
 *
 * @param text - The value as typed.
 * @param max - The longest value the API accepts, after trimming.
 * @returns The problem, or `undefined`.
 */
export function checkText(text: string, max?: number): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return REQUIRED_MESSAGE
  if (max !== undefined && trimmed.length > max) return `Must be ${max} characters or fewer.`
  return undefined
}

/**
 * Collects per-field results into a form's errors, dropping the fields that passed.
 *
 * @param checks - The result of each field's check, by field name.
 * @param form - A problem that is not about one field, if any.
 * @returns The errors to show.
 */
export function fieldErrors(checks: Readonly<Record<string, string | undefined>>, form: string | null = null): FormErrors {
  const fields: Record<string, string> = {}
  for (const [field, message] of Object.entries(checks)) {
    if (message !== undefined) fields[field] = message
  }
  return { fields, form }
}
