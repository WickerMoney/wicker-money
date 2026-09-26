import type { Transaction } from '../models/index.js'

/**
 * Builds a transaction for a test.
 *
 * @param patch - Fields to override.
 * @returns An uncategorized, non-transfer transaction.
 */
export function makeTransaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 't-1', merchant: 'Coffee', amount: '-4.50', transaction_date: '2026-03-01',
    category_id: null, category_source: null, notes: null, transfer_id: null, ...patch,
  }
}
