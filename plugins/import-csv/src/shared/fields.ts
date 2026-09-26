/**
 * Turning raw cells into ledger values.
 *
 * Every function here fails by returning an error rather than by guessing. A
 * bad import is recoverable; a silently wrong one is not — a date read as the
 * wrong day or an amount rounded through a float looks exactly like real data
 * six months later, and there is nothing left to compare it against.
 */

import { checkDateParts } from './checkDateParts.js'
import { normalizeDecimalSeparator } from './normalizeDecimalSeparator.js'
import { readDateParts } from './readDateParts.js'
import { stripMoneySign } from './stripMoneySign.js'

/** Date layouts a source can use. The user chooses one; it is never inferred from the data. */
export const DATE_FORMATS = [
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY-MM-DD',
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'DD.MM.YYYY',
  'YYYY/MM/DD',
] as const
/** One of the supported date layouts. */
export type DateFormat = (typeof DATE_FORMATS)[number]

/**
 * Checks whether a string is one of the supported date layouts.
 *
 * @param value - The string to test.
 * @returns `true` when `value` is in `DATE_FORMATS`, narrowing it to `DateFormat`.
 */
export function isDateFormat(value: string): value is DateFormat {
  return (DATE_FORMATS as readonly string[]).includes(value)
}

/**
 * Picks the default format from a locale, for the UI's initial selection only.
 *
 * A default is not a guess: the value is shown in the picker, applied to the
 * preview, and can be changed before anything is written. Inferring a format
 * from the file's contents would be a guess, because `03/04/2026` is valid in
 * both layouts.
 *
 * @param locale - A BCP 47 locale tag such as `en-US`.
 * @returns `MM/DD/YYYY` for US English, `DD/MM/YYYY` otherwise.
 */
export function defaultDateFormat(locale: string): DateFormat {
  return locale.toLowerCase().endsWith('-us') || locale.toLowerCase() === 'en'
    ? 'MM/DD/YYYY'
    : 'DD/MM/YYYY'
}

/**
 * Parses a date in the chosen format, returning ISO `YYYY-MM-DD` or an error.
 *
 * Rejects a date that does not round-trip, so 31/02 fails rather than becoming
 * 3 March the way Date's own rollover would. A two-digit year is read as 20xx,
 * and anything after the date (a space or `T` and a time) is ignored.
 *
 * @param raw - The cell text.
 * @param format - The layout the source uses.
 * @returns `{ value }` with the ISO date, or `{ error }` describing why it failed.
 */
export function parseDate(raw: string, format: DateFormat): { value: string } | { error: string } {
  const text = raw.trim()
  if (text === '') return { error: 'empty' }

  // Tolerate a time suffix: "03/04/2026 14:22" and "2026-03-04T00:00:00Z".
  const parts = readDateParts(text.split(/[ T]/, 1)[0]!, format)
  return 'error' in parts ? parts : checkDateParts(parts)
}

/** How a source expresses money, chosen per source and never inferred: one signed column, or separate debit and credit columns. */
export const AMOUNT_STYLES = ['signed', 'debit-credit'] as const
/** One of the supported amount styles. */
export type AmountStyle = (typeof AMOUNT_STYLES)[number]

/**
 * Parses money into a fixed-point decimal string — never a number.
 *
 * `Number('0.1') + Number('0.2')` is the reason. Money crosses this boundary as
 * text and stays text all the way into `numeric(19,4)`; nothing here converts
 * to a float even transiently.
 *
 * Handles the shapes exports actually use: thousands separators, a currency
 * symbol, parentheses for negatives, a trailing minus, and European decimal
 * commas.
 *
 * @param raw - The cell text.
 * @returns `{ value }` with a plain decimal string (`-` prefix when negative,
 *   never `-0`), or `{ error }` when the text is empty, not a number, has more
 *   than four decimal places, or has more than 15 whole digits.
 */
export function parseMoney(raw: string): { value: string } | { error: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: 'empty' }

  const signed = stripMoneySign(trimmed)
  if (signed === null) return { error: `not a number: ${raw}` }
  const { negative } = signed
  const text = normalizeDecimalSeparator(signed.text)

  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') {
    return { error: `not a number: ${raw}` }
  }

  const [whole = '0', fraction = ''] = text.split('.')
  if (fraction.length > 4) return { error: `more than 4 decimal places: ${raw}` }

  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  const normalized = fraction === '' ? normalizedWhole : `${normalizedWhole}.${fraction}`
  if (normalizedWhole.length > 15) return { error: `too large: ${raw}` }

  const isZero = /^0(\.0*)?$/.test(normalized)
  return { value: negative && !isZero ? `-${normalized}` : normalized }
}

/**
 * Negates a fixed-point money string without converting it to a float.
 *
 * @param value - A decimal string such as `12.50` or `-3`.
 * @returns The string with its sign flipped; zero is returned unchanged.
 */
export function negateMoney(value: string): string {
  if (/^0(\.0*)?$/.test(value)) return value
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}
