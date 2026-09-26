/**
 * Rewrites money text so that `.` is the only decimal separator and no
 * thousands separators remain.
 *
 * When both `,` and `.` appear, whichever comes last is the decimal separator.
 * A lone comma is decimal only when it leaves one or two digits after it;
 * `1,234` is one thousand two hundred and thirty-four, not 1.234.
 *
 * @param text - Digits, commas and dots only.
 * @returns The text with a `.` decimal point and no grouping characters.
 */
export function normalizeDecimalSeparator(text: string): string {
  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    return lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  }
  if (lastComma !== -1) {
    const after = text.length - lastComma - 1
    return after === 1 || after === 2 ? text.replace(',', '.') : text.replace(/,/g, '')
  }
  return text
}
