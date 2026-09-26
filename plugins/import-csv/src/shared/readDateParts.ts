import { DATE_ORDER } from './DATE_ORDER.js'
import type { DateParts } from './DateParts.js'
import type { DateFormat } from './fields.js'

/**
 * Splits date text into year, month and day according to a layout.
 *
 * A two-digit year is read as 20xx. Only the shape is checked here: three
 * all-digit pieces separated by the layout's separator.
 *
 * @param dateOnly - The date text with any time suffix already removed.
 * @param format - The layout the source uses.
 * @returns The numeric parts, or `{ error }` when the text does not match the layout.
 */
export function readDateParts(dateOnly: string, format: DateFormat): DateParts | { error: string } {
  const { sep, parts } = DATE_ORDER[format]
  const pieces = dateOnly.split(sep)
  const mismatch = { error: `does not match ${format}` }
  if (pieces.length !== 3) return mismatch

  let year = 0
  let month = 0
  let day = 0
  for (let i = 0; i < 3; i += 1) {
    const piece = pieces[i]!
    if (!/^\d+$/.test(piece)) return mismatch
    const n = Number(piece)
    if (parts[i] === 'Y') year = piece.length === 2 ? 2000 + n : n
    else if (parts[i] === 'M') month = n
    else day = n
  }
  return { year, month, day }
}
