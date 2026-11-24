import { editableMoney } from '@wickermoney/plugin-sdk/money'
import type { LumpSum, LumpSumDraft } from '../models/index.js'

/**
 * Fills the form from a saved lump sum. Amounts are shown to the cent, or with
 * all four places when the saved value has sub-cent precision, so editing never
 * rounds anything away.
 */
export function draftFromLumpSum(lump: LumpSum): LumpSumDraft {
  return {
    onDate: lump.onDate,
    amount: editableMoney(lump.amount),
    note: lump.note,
    allocations: Object.fromEntries(lump.allocations.map((a) => [a.debtId, editableMoney(a.amount)])),
  }
}
