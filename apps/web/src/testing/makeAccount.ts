import type { Account } from '../models/index.js'

/**
 * Builds an account for a test.
 *
 * @param patch - Fields to override.
 * @returns An active USD checking account.
 */
export function makeAccount(patch: Partial<Account> = {}): Account {
  return {
    id: 'acc-1', name: 'Checking', accountType: 'checking', initialBalance: '100.00',
    balance: '250.00', currencyCode: 'USD', bufferAmount: '0.00', archivedAt: null, ...patch,
  }
}
