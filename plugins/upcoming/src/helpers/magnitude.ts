/**
 * An amount without its sign, as text. Never parsed to a number, so no
 * rounding can touch it.
 *
 * @param value - A decimal string such as `'-120.5000'`.
 * @returns The same digits without a leading `-` or `+`.
 */
export function magnitude(value: string): string {
  return value.trim().replace(/^[+-]/, '')
}
