/**
 * Reduces a merchant string to the form used to compare merchants.
 *
 * Exports are inconsistent about case, padding and punctuation, so the
 * comparison lower-cases, replaces every run of other characters with one space
 * and trims.
 *
 * @param s - The merchant text.
 * @returns The comparison form of `s`.
 */
export function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
