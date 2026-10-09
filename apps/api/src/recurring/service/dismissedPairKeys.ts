import type { DismissalRow } from '../repository/DismissalRow.js'
import { pairKey } from './pairKey.js'

/**
 * The dismissed transaction and occurrence pairs, for excluding them from suggestions.
 *
 * @param dismissals - The user's dismissals.
 * @returns The {@link pairKey} of each.
 */
export function dismissedPairKeys(dismissals: readonly DismissalRow[]): Set<string> {
  return new Set(dismissals.map((d) => pairKey(d.transaction_id, d.recurring_item_id, d.nominal_date)))
}
