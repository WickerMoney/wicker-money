import type { Query } from '@wickermoney/plugin-sdk/server'
import type { AccountRepository } from './AccountRepository.js'
import type { AccountRow, LiabilityAccountRow } from './AccountRow.js'

/**
 * {@link AccountRepository} over a user-bound query runner.
 *
 * The plugin's `accounts` grant is read-only, and row-level security applies to
 * it as to every table, so another user's account is simply not found.
 */
export class QueryAccountRepository implements AccountRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async find(id: string): Promise<AccountRow | undefined> {
    const rows = await this.q<AccountRow>`
      SELECT id, name, account_type::text AS account_type, archived_at IS NOT NULL AS archived
      FROM core.accounts
      WHERE id = ${id}::uuid
    `
    return rows[0]
  }

  /** @inheritdoc */
  listLiabilities(): Promise<LiabilityAccountRow[]> {
    // One statement for the accounts and the debts that track them. An
    // archived debt does not count as tracking: the unique index lets a new
    // debt take the account over.
    return this.q<LiabilityAccountRow>`
      SELECT a.id, a.name, a.account_type::text AS account_type, d.id AS debt_id
      FROM core.accounts a
      LEFT JOIN plugin_debt_payoff.debts d ON d.account_id = a.id AND NOT d.archived
      WHERE a.account_type IN ('credit_card', 'loan') AND a.archived_at IS NULL
      ORDER BY a.name, a.id
    `
  }
}
