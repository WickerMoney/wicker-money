/**
 * Splits a list into consecutive slices.
 *
 * @param items - The list to split.
 * @param size - The largest slice length; must be at least 1.
 * @returns The slices, in order; empty when `items` is empty.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const slices: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    slices.push(items.slice(start, start + size))
  }
  return slices
}
