import type { Situation } from '../../categories/catalog.js'

/**
 * Puts the always-on situation first and drops any repeat of it.
 *
 * `always` is implied by every setup and cannot be declined: a finished setup
 * that created nothing would leave an empty category picker with no obvious way back.
 *
 * @param situations - The situations the user chose.
 * @returns `always` followed by the other choices, in their given order.
 */
export function withAlways(situations: readonly Situation[]): Situation[] {
  return ['always', ...situations.filter((s) => s !== 'always')]
}
