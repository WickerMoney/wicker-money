import { Decimal } from 'decimal.js'
import { money, toMoney } from '../../money.js'
import type { InitialBalancePreview } from './InitialBalancePreview.js'

/**
 * Formats an amount at the storage scale without a negative zero.
 *
 * Decimal arithmetic keeps the sign of a zero (`-0` renders as `-0.0000`),
 * which the database never stores and a client should never be shown.
 */
function formatAmount(value: Decimal | string): string {
  const amount = new Decimal(value)
  return toMoney(amount.isZero() ? 0 : amount)
}

/**
 * Computes the effect of a new opening balance with exact decimal arithmetic.
 *
 * The balance is `initial_balance + SUM(transactions.amount)`, so the ledger's
 * own contribution (current balance minus current opening balance) stays
 * constant while the opening number changes.
 *
 * @param currentInitialBalance - The stored opening balance.
 * @param currentBalance - The derived balance today.
 * @param newInitialBalance - The proposed opening balance.
 * @returns Current and proposed figures at the storage scale, plus the delta.
 */
export function previewInitialBalanceChange(
  currentInitialBalance: string,
  currentBalance: string,
  newInitialBalance: string,
): InitialBalancePreview {
  const current = money(currentInitialBalance)
  const ledgerActivity = money(currentBalance).minus(current)
  const proposed = money(newInitialBalance)
  return {
    currentInitialBalance: formatAmount(current),
    currentBalance: formatAmount(currentBalance),
    newInitialBalance: formatAmount(proposed),
    newBalance: formatAmount(proposed.plus(ledgerActivity)),
    delta: formatAmount(proposed.minus(current)),
  }
}
