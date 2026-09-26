/**
 * Orders two strings by code unit, without locale rules.
 *
 * @param a - The first string.
 * @param b - The second string.
 * @returns A negative number, zero or a positive number as `a` sorts before, equal to or after `b`.
 */
export function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
