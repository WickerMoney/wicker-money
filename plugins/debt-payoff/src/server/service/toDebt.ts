import type { DebtRow } from '../repository/DebtRow.js'
import type { Debt } from './Debt.js'

/**
 * Maps a stored debt to the shape the API returns.
 *
 * @param row - A debt row.
 * @returns The same debt with camel-cased names.
 */
export function toDebt(row: DebtRow): Debt {
  return {
    id: row.id,
    name: row.name,
    balance: row.balance,
    apr: row.apr,
    minimumPayment: row.minimum_payment,
    accountId: row.account_id,
    sortOrder: row.sort_order,
    archived: row.archived,
  }
}
