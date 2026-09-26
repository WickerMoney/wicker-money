/**
 * The colour of each named series, by rank.
 *
 * Five, and never cycled: the palette is validated for a fixed number of slots
 * and inventing a sixth hue is what its rules forbid. A category ranked past
 * the fifth folds into "Other", which has its own neutral colour.
 */
export const SERIES_COLORS = [
  'var(--spt-1)',
  'var(--spt-2)',
  'var(--spt-3)',
  'var(--spt-4)',
  'var(--spt-5)',
] as const
