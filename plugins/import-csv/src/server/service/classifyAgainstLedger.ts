import { classifyRows, type ClassifiedRow, type MappedRow } from '../../shared/index.js'
import type { LedgerRepository } from '../repository/LedgerRepository.js'
import { dateWindow } from './dateWindow.js'

/**
 * Classifies mapped rows against the account's existing transactions.
 *
 * @param ledger - Ledger repository bound to the current user.
 * @param accountId - The target account.
 * @param rows - The mapped rows.
 * @returns One verdict per row, in file order.
 */
export async function classifyAgainstLedger(
  ledger: LedgerRepository,
  accountId: string,
  rows: readonly MappedRow[],
): Promise<ClassifiedRow[]> {
  const window = dateWindow(rows.map((r) => r.date))
  const existing = window === null ? [] : await ledger.findInWindow(accountId, window.from, window.to)
  return classifyRows(rows, existing)
}
