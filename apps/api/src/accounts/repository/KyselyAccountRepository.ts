import { sql } from 'kysely'
import { translateDuplicateKey } from '../../data/translateDuplicateKey.js'
import type { Trx } from '../../db/Trx.js'
import type { AccountChanges } from './AccountChanges.js'
import type { AccountLabel } from './AccountLabel.js'
import type { AccountRepository } from './AccountRepository.js'
import type { AccountWithBalance } from './AccountWithBalance.js'
import { databaseNow } from './databaseNow.js'
import type { HistoryDeletion } from './HistoryDeletion.js'
import type { MigrationAccount } from './MigrationAccount.js'
import type { MigrationCounts } from './MigrationCounts.js'
import type { NewAccountInput } from './NewAccountInput.js'
import { SELECT_WITH_BALANCE } from './SELECT_WITH_BALANCE.js'

/** Tables whose rows reference accounts as `account_id` and `transfer_account_id`. */
type AccountReferencingTable = 'core.transactions' | 'core.recurring_items'

/** Kysely implementation of {@link AccountRepository} over a single transaction. */
export class KyselyAccountRepository implements AccountRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  async listWithBalances(includeArchived: boolean): Promise<AccountWithBalance[]> {
    const query = includeArchived
      ? sql<AccountWithBalance>`${SELECT_WITH_BALANCE} ORDER BY a.name`
      : sql<AccountWithBalance>`${SELECT_WITH_BALANCE} WHERE a.archived_at IS NULL ORDER BY a.name`
    return (await query.execute(this.trx)).rows
  }

  /** @inheritdoc */
  async findWithBalance(id: string): Promise<AccountWithBalance | undefined> {
    const result = await sql<AccountWithBalance>`${SELECT_WITH_BALANCE} WHERE a.id = ${id}`.execute(this.trx)
    return result.rows[0]
  }

  /** @inheritdoc */
  findLabel(id: string): Promise<AccountLabel | undefined> {
    return this.trx.selectFrom('core.accounts').select(['id', 'name']).where('id', '=', id).executeTakeFirst()
  }

  /** @inheritdoc */
  findMigrationAccounts(ids: readonly string[]): Promise<MigrationAccount[]> {
    return this.trx
      .selectFrom('core.accounts')
      .select(['id', 'name', 'currency_code'])
      .where('id', 'in', [...ids])
      .execute()
  }

  /** @inheritdoc */
  async insert(input: NewAccountInput): Promise<AccountWithBalance> {
    const inserted = await this.trx
      .insertInto('core.accounts')
      .values({
        user_id: input.userId,
        name: input.name,
        account_type: input.accountType,
        initial_balance: input.initialBalance,
        currency_code: input.currencyCode,
        buffer_amount: input.bufferAmount,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return (await this.findWithBalance(inserted.id))!
  }

  /** @inheritdoc */
  async update(id: string, changes: AccountChanges): Promise<AccountWithBalance | undefined> {
    const updated = await this.trx
      .updateTable('core.accounts')
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.accountType !== undefined ? { account_type: changes.accountType } : {}),
        ...(changes.currencyCode !== undefined ? { currency_code: changes.currencyCode } : {}),
        ...(changes.bufferAmount !== undefined ? { buffer_amount: changes.bufferAmount } : {}),
        updated_at: databaseNow,
      })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst()
    return updated === undefined ? undefined : this.findWithBalance(id)
  }

  /** @inheritdoc */
  async archive(id: string): Promise<AccountWithBalance | undefined> {
    const updated = await this.trx
      .updateTable('core.accounts')
      .set({ archived_at: databaseNow, updated_at: databaseNow })
      .where('id', '=', id)
      .where('archived_at', 'is', null)
      .returning('id')
      .executeTakeFirst()
    return updated === undefined ? undefined : this.findWithBalance(id)
  }

  /** @inheritdoc */
  async setInitialBalance(id: string, initialBalance: string): Promise<AccountWithBalance | undefined> {
    const updated = await this.trx
      .updateTable('core.accounts')
      .set({ initial_balance: initialBalance, updated_at: databaseNow })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst()
    return updated === undefined ? undefined : this.findWithBalance(id)
  }

  /** @inheritdoc */
  async delete(id: string): Promise<boolean> {
    const gone = await this.trx.deleteFrom('core.accounts').where('id', '=', id).returning('id').executeTakeFirst()
    return gone !== undefined
  }

  /** @inheritdoc */
  async countMigrationRows(fromId: string, toId: string): Promise<MigrationCounts> {
    const [transactions, recurringItems] = await Promise.all([
      this.countMigrationRowsIn('core.transactions', fromId, toId),
      this.countMigrationRowsIn('core.recurring_items', fromId, toId),
    ])
    return {
      transferTransactions: transactions.transfers,
      transferRecurringItems: recurringItems.transfers,
      otherTransactions: transactions.others,
      otherRecurringItems: recurringItems.others,
    }
  }

  /** @inheritdoc */
  async moveHistory(fromId: string, toId: string): Promise<void> {
    for (const table of ['core.transactions', 'core.recurring_items'] as const) {
      await this.trx
        .deleteFrom(table)
        .where((eb) =>
          eb.or([
            eb.and([eb('account_id', '=', fromId), eb('transfer_account_id', '=', toId)]),
            eb.and([eb('account_id', '=', toId), eb('transfer_account_id', '=', fromId)]),
          ]),
        )
        .execute()
    }

    // The unique index is per (account_id, external_id), so merging two
    // accounts that share an external id, most likely because both were
    // imported from the same source, collides here.
    await translateDuplicateKey(async () => {
      await this.trx
        .updateTable('core.transactions')
        .set({ account_id: toId, updated_at: databaseNow })
        .where('account_id', '=', fromId)
        .execute()
      await this.trx
        .updateTable('core.transactions')
        .set({ transfer_account_id: toId, updated_at: databaseNow })
        .where('transfer_account_id', '=', fromId)
        .execute()
    })

    await this.trx
      .updateTable('core.recurring_items')
      .set({ account_id: toId, updated_at: databaseNow })
      .where('account_id', '=', fromId)
      .execute()
    await this.trx
      .updateTable('core.recurring_items')
      .set({ transfer_account_id: toId, updated_at: databaseNow })
      .where('transfer_account_id', '=', fromId)
      .execute()
  }

  /** @inheritdoc */
  async deleteHistory(id: string): Promise<HistoryDeletion> {
    const transactions = await this.trx
      .deleteFrom('core.transactions')
      .where((eb) => eb.or([eb('account_id', '=', id), eb('transfer_account_id', '=', id)]))
      .returning('id')
      .execute()
    const recurringItems = await this.trx
      .deleteFrom('core.recurring_items')
      .where((eb) => eb.or([eb('account_id', '=', id), eb('transfer_account_id', '=', id)]))
      .returning('id')
      .execute()
    return { transactions: transactions.length, recurringItems: recurringItems.length }
  }

  /**
   * Splits the rows of one table that refer to `fromId` into transfers between
   * the two accounts and everything else.
   *
   * `transfer_account_id` is NULL on every ordinary row, so the "between the
   * two accounts" test is NULL rather than false for them; `IS TRUE` and
   * `IS NOT TRUE` keep such rows counted as "others" instead of dropping them.
   */
  private async countMigrationRowsIn(
    table: AccountReferencingTable,
    fromId: string,
    toId: string,
  ): Promise<{ transfers: number; others: number }> {
    const result = await sql<{ transfers: string; others: string }>`
      SELECT
        count(*) FILTER (WHERE between_the_two IS TRUE)::text AS transfers,
        count(*) FILTER (WHERE between_the_two IS NOT TRUE)::text AS others
      FROM (
        SELECT (
          (account_id = ${fromId} AND transfer_account_id = ${toId})
          OR (account_id = ${toId} AND transfer_account_id = ${fromId})
        ) AS between_the_two
        FROM ${sql.table(table)}
        WHERE account_id = ${fromId} OR transfer_account_id = ${fromId}
      ) refs
    `.execute(this.trx)
    const row = result.rows[0]
    return { transfers: Number(row?.transfers ?? 0), others: Number(row?.others ?? 0) }
  }
}
