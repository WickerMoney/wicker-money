/**
 * Computes the vertical extent of a bar drawn from the zero line to a signed value.
 *
 * Positive values draw upward and negative values downward. A value of exactly
 * zero draws nothing, not a stub, which would put a mark where there is no money.
 * Any other value is at least 2 pixels tall so that it stays visible.
 *
 * @param value - The signed value.
 * @param zeroY - The y coordinate of the zero line.
 * @param scale - Converts a value to a pixel height.
 * @returns The bar's top `y` and its height `h`.
 */
export function bar(
  value: number, zeroY: number, scale: (v: number) => number,
): { readonly y: number; readonly h: number } {
  if (value === 0) return { y: zeroY, h: 0 }
  const h = Math.max(Math.abs(scale(value)), 2)
  return value > 0 ? { y: zeroY - h, h } : { y: zeroY, h }
}
