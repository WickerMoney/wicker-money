/** How many debts get a colour of their own; the rest share "Other". */
export const NAMED_COLORS = 6

/** The grey a folded band wears. */
export const OTHER_COLOR = 'var(--wm-chart-other)'

/**
 * The colour of the debt at a place in the person's own list.
 *
 * Colour follows the debt's place in the list, not its place in the payoff
 * order, so switching strategy reorders the stack without repainting anything.
 *
 * @param position - Zero-based place in the person's list.
 * @returns A design token, or the "other" grey past the sixth debt.
 */
export function colorFor(position: number): string {
  return position < NAMED_COLORS ? `var(--wm-chart-${position + 1})` : OTHER_COLOR
}
