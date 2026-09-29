import type { AccountWithBalance } from '../../repository/AccountWithBalance.js'

/**
 * Converts an account row into the camelCase shape returned by the API.
 *
 * @param row - An account with its derived balance.
 * @returns The account as sent to clients.
 */
export function present(row: AccountWithBalance) {
  return {
    id: row.id,
    name: row.name,
    accountType: row.account_type,
    initialBalance: row.initial_balance,
    balance: row.balance,
    currencyCode: row.currency_code,
    bufferAmount: row.buffer_amount,
    spendable: row.spendable,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
