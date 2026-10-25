/**
 * Names the debts a plan leaves out, for a sentence: `Mortgage`,
 * `Mortgage and Car loan`, `A, B and C`, or `A, B, C and 2 more`.
 *
 * @param names - The names of the excluded debts, in the person's order.
 * @returns The phrase, or `''` when nothing is left out.
 */
export function excludingText(names: readonly string[]): string {
  const [first, second, third] = names
  if (first === undefined) return ''
  if (second === undefined) return first
  if (names.length === 2) return `${first} and ${second}`
  if (third === undefined || names.length === 3) return `${first}, ${second} and ${third ?? ''}`
  return `${first}, ${second}, ${third} and ${names.length - 3} more`
}
