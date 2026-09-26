import type { TrendSeries } from '../models/index.js'
import { OTHER_COLOR } from './OTHER_COLOR.js'
import { SERIES_COLORS } from './SERIES_COLORS.js'

/**
 * Picks a series' colour.
 *
 * Keyed on the series' position in the full ranking, not among the visible ones,
 * so hiding a category never recolours the rest.
 *
 * @param series - The series.
 * @param rank - Its zero-based position among all series, largest first.
 * @returns A CSS colour: a palette slot, or the neutral for the fold.
 */
export function seriesColor(series: TrendSeries, rank: number): string {
  if (series.folded) return OTHER_COLOR
  return SERIES_COLORS[rank] ?? OTHER_COLOR
}
