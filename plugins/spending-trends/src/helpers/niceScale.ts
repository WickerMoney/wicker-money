import type { NiceScale } from '../models/index.js'
import { niceStep } from './niceStep.js'

/** The most gridline intervals the axis may have, above and below zero together. */
const MAX_INTERVALS = 6

/** How many intervals a step needs to cover both directions of the stack. */
function intervalsNeeded(maxUp: number, maxDown: number, step: number): number {
  return Math.ceil(maxUp / step) + Math.ceil(maxDown / step)
}

/**
 * Builds a y-axis that ends on round numbers and always contains zero.
 *
 * The top is the first tick at or above the tallest upward stack, and the bottom
 * the first at or below the deepest downward one, so nothing is cut off and
 * every gridline is a value a reader can say aloud.
 *
 * The step is the *smallest* round one that keeps the axis to six intervals,
 * not the one nearest a fixed count. Rounding a $10,950 peak up to a $5,000 step
 * would end the axis at $15,000 and leave a third of the plot empty; a $2,000
 * step ends it at $12,000.
 *
 * @param maxUp - The tallest upward stack, as a magnitude.
 * @param maxDown - The deepest downward stack, as a magnitude.
 * @returns The axis limits and every gridline value, lowest first.
 */
export function niceScale(maxUp: number, maxDown: number): NiceScale {
  const span = maxUp + maxDown
  // Nothing to plot, for instance every series hidden or a range with no
  // spending: a unit-high axis keeps the geometry finite.
  if (!(span > 0)) return { top: 1, bottom: 0, ticks: [0, 1] }

  let step = niceStep(span / MAX_INTERVALS)
  // Rounding each direction up can need one more interval than the span
  // suggests, so widen the step until it fits. Each pass moves to the next
  // round step, and the loop ends because the count falls as the step grows.
  while (intervalsNeeded(maxUp, maxDown, step) > MAX_INTERVALS) step = niceStep(step * 1.01)

  const top = Math.ceil(maxUp / step) * step
  const bottom = maxDown > 0 ? -Math.ceil(maxDown / step) * step : 0
  const count = Math.round((top - bottom) / step)
  const ticks = Array.from({ length: count + 1 }, (_, i) => bottom + i * step)
  return { top, bottom, ticks }
}
