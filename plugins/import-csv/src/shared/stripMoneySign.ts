/**
 * Removes currency symbols and every way a source writes "negative" from money text.
 *
 * Handles parentheses, a trailing minus and a leading `-` or `+`. Text that
 * still contains a sign afterwards (`1-2`, `--5`) is not money.
 *
 * @param raw - Trimmed, non-empty cell text.
 * @returns The sign and the remaining digits, commas and dots, or `null` when a stray sign remains.
 */
export function stripMoneySign(raw: string): { negative: boolean; text: string } | null {
  let text = raw
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1).trim()
  }
  if (text.endsWith('-')) {
    negative = true
    text = text.slice(0, -1).trim()
  }

  text = text.replace(/[^\d.,+-]/g, '')

  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }
  if (text.includes('-') || text.includes('+')) return null
  return { negative, text }
}
