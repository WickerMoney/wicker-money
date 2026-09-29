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

/** Recurring-item kinds whose two legs make them a transfer between two accounts. */
const TWO_ACCOUNT_KINDS = ['transfer', 'debt_payment'] as const

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
        spendable: input.spendable,
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
        ...(changes.spendable !== undefined ? { spendable: changes.spendable } : {}),
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
      this.countTransactionMigrationRows(fromId, toId),
      this.countRecurringMigrationRows(fromId, toId),
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
    await this.trx
      .deleteFrom('core.transactions')
      .where((eb) =>
        eb.or([
          eb.and([eb('account_id', '=', fromId), eb('transfer_account_id', '=', toId)]),
          eb.and([eb('account_id', '=', toId), eb('transfer_account_id', '=', fromId)]),
        ]),
      )
      .execute()

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

    await this.moveRecurringLegs(fromId, toId)
  }

  /**
   * Moves recurring-item legs from one account to another.
   *
   * An item with a leg on each account is the one case that needs a decision,
   * because legs are one per account per item:
   *
   * - a transfer or debt payment between the two becomes a transfer from an
   *   account to itself, so it is deleted (as transactions are);
   * - a split paycheck into both keeps paying the same total, so its two legs
   *   are summed into the target's.
   *
   * Every other leg on the source is re-pointed. The legs trigger checks the
   * result at commit.
   */
  private async moveRecurringLegs(fromId: string, toId: string): Promise<void> {
    await sql`
      DELETE FROM core.recurring_items i
       WHERE i.kind IN (${sql.join(TWO_ACCOUNT_KINDS.map((k) => sql.lit(k)))})
         AND EXISTS (SELECT 1 FROM core.recurring_item_legs f WHERE f.recurring_item_id = i.id AND f.account_id = ${fromId})
         AND EXISTS (SELECT 1 FROM core.recurring_item_legs t WHERE t.recurring_item_id = i.id AND t.account_id = ${toId})
    `.execute(this.trx)
    await sql`
      UPDATE core.recurring_item_legs t
         SET amount = t.amount + f.amount, updated_at = now()
        FROM core.recurring_item_legs f
       WHERE f.recurring_item_id = t.recurring_item_id
         AND f.account_id = ${fromId}
         AND t.account_id = ${toId}
    `.execute(this.trx)
    await sql`
      DELETE FROM core.recurring_item_legs f
       WHERE f.account_id = ${fromId}
         AND EXISTS (
           SELECT 1 FROM core.recurring_item_legs t
            WHERE t.recurring_item_id = f.recurring_item_id AND t.account_id = ${toId}
         )
    `.execute(this.trx)
    await this.trx
      .updateTable('core.recurring_item_legs')
      .set({ account_id: toId, updated_at: databaseNow })
      .where('account_id', '=', fromId)
      .execute()
  }

  /** @inheritdoc */
  async deleteHistory(id: string): Promise<HistoryDeletion> {
    const transactions = await this.trx
      .deleteFrom('core.transactions')
      .where((eb) => eb.or([eb('account_id', '=', id), eb('transfer_account_id', '=', id)]))
      .returning('id')
      .execute()
    // The whole item goes, not just the leg: a paycheck that silently shrank
    // in the forecast would be harder to notice than one that is gone. Legs
    // cascade from the item.
    const recurringItems = await this.trx
      .deleteFrom('core.recurring_items')
      .where((eb) =>
        eb.exists(
          eb.selectFrom('core.recurring_item_legs as l')
            .select('l.id')
            .whereRef('l.recurring_item_id', '=', 'core.recurring_items.id')
            .where('l.account_id', '=', id),
        ),
      )
      .returning('id')
      .execute()
    return { transactions: transactions.length, recurringItems: recurringItems.length }
  }

  /**
   * Splits the transactions that refer to `fromId` into transfers between the
   * two accounts and everything else.
   *
   * `transfer_account_id` is NULL on every ordinary row, so the "between the
   * two accounts" test is NULL rather than false for them; `IS TRUE` and
   * `IS NOT TRUE` keep such rows counted as "others" instead of dropping them.
   */
  private async countTransactionMigrationRows(
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
        FROM core.transactions
        WHERE account_id = ${fromId} OR transfer_account_id = ${fromId}
      ) refs
    `.execute(this.trx)
    const row = result.rows[0]
    return { transfers: Number(row?.transfers ?? 0), others: Number(row?.others ?? 0) }
  }

  /**
   * Splits the recurring items with a leg on `fromId` into transfers (or debt
   * payments) between the two accounts, which a merge deletes, and everything
   * else, which it moves. Counted per item, not per leg.
   */
  private async countRecurringMigrationRows(
    fromId: string,
    toId: string,
  ): Promise<{ transfers: number; others: number }> {
    const result = await sql<{ transfers: string; others: string }>`
      SELECT
        count(*) FILTER (WHERE between_the_two)::text AS transfers,
        count(*) FILTER (WHERE NOT between_the_two)::text AS others
      FROM (
        SELECT (
          i.kind IN (${sql.join(TWO_ACCOUNT_KINDS.map((k) => sql.lit(k)))})
          AND EXISTS (
            SELECT 1 FROM core.recurring_item_legs t WHERE t.recurring_item_id = i.id AND t.account_id = ${toId}
          )
        ) AS between_the_two
        FROM core.recurring_items i
        WHERE EXISTS (
          SELECT 1 FROM core.recurring_item_legs f WHERE f.recurring_item_id = i.id AND f.account_id = ${fromId}
        )
      ) refs
    `.execute(this.trx)
    const row = result.rows[0]
    return { transfers: Number(row?.transfers ?? 0), others: Number(row?.others ?? 0) }
  }
}
