import type { RecurringKind } from '../../db/models/index.js'
import { addMoney } from '../../money.js'

/**
 * One amount that stands for an item or an occurrence: what income brings in
 * (all legs), what a bill costs (its one negative leg), or what a transfer
 * moves (its positive leg — a transfer's legs net to zero, which says nothing).
 *
 * @param kind - The item's kind.
 * @param legs - The legs, signed.
 * @returns A four-decimal amount.
 */
export function headlineAmount(kind: RecurringKind, legs: readonly { readonly amount: string }[]): string {
  if (kind === 'transfer' || kind === 'debt_payment') {
    return addMoney(legs.find((l) => !l.amount.startsWith('-'))?.amount ?? '0')
  }
  return addMoney('0', ...legs.map((l) => l.amount))
}
