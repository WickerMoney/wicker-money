import { sql, type Updateable } from 'kysely'
import type { CategorySource, Transaction, TransactionsTable } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import { translateDuplicateKey } from '../../data/translateDuplicateKey.js'
import type { AccountName } from './AccountName.js'
import type { NewTransactionInput } from './NewTransactionInput.js'
import type { NewTransferLegInput } from './NewTransferLegInput.js'
import { SORT_COLUMNS } from './SORT_COLUMNS.js'
import type { TransactionChanges } from './TransactionChanges.js'
import { keysetFilter } from './keysetFilter.js'
import { transactionFilters } from './transactionFilters.js'
import type { TransactionFilterCriteria } from './TransactionFilterCriteria.js'
import type { TransactionListCriteria } from './TransactionListCriteria.js'
import type { TransactionPage } from './TransactionPage.js'
import type { TransactionRepository } from './TransactionRepository.js'

/** Kysely implementation of {@link TransactionRepository}. */
export class KyselyTransactionRepository implements TransactionRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  async listPage(criteria: TransactionListCriteria): Promise<TransactionPage> {
    const { sort, direction, limit, after } = criteria

    let query = this.trx.selectFrom('core.transactions').selectAll().where(transactionFilters(criteria))
    if (after !== undefined) query = query.where(keysetFilter(sort, direction, after))

    // One row more than asked for tells whether another page follows, without
    // counting.
    const rows = await query
      .orderBy(SORT_COLUMNS[sort], direction)
      // Ordered the same way as the sort column so the keyset predicate is one
      // row comparison, and unique so equal values never repeat or skip a row.
      .orderBy('id', direction)
      .limit(limit + 1)
      .execute()

    return { items: rows.slice(0, limit), hasMore: rows.length > limit }
  }

  /** @inheritdoc */
  async countMatching(criteria: TransactionFilterCriteria): Promise<number> {
    const { total } = await this.trx
      .selectFrom('core.transactions')
      .select(({ fn }) => fn.countAll().as('total'))
      .where(transactionFilters(criteria))
      .executeTakeFirstOrThrow()
    return Number(total)
  }

  /** @inheritdoc */
  findById(id: string): Promise<Transaction | undefined> {
    return this.trx.selectFrom('core.transactions').selectAll().where('id', '=', id).executeTakeFirst()
  }

  /** @inheritdoc */
  lockById(id: string): Promise<Transaction | undefined> {
    return this.trx.selectFrom('core.transactions').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
  }

  /** @inheritdoc */
  lockTransferLegs(transferId: string): Promise<Transaction[]> {
    return this.trx
      .selectFrom('core.transactions')
      .selectAll()
      .where('transfer_id', '=', transferId)
      .orderBy('id', 'asc')
      .forUpdate()
      .execute()
  }

  /** @inheritdoc */
  insert(input: NewTransactionInput): Promise<Transaction> {
    // external_id is the authoritative dedupe key, enforced by a partial unique
    // index rather than by a heuristic.
    return translateDuplicateKey(() =>
      this.trx
        .insertInto('core.transactions')
        .values({
          user_id: input.userId,
          account_id: input.accountId,
          amount: input.amount,
          merchant: input.merchant,
          transaction_date: input.transactionDate,
          category_id: input.categoryId,
          category_source: input.categorySource,
          notes: input.notes,
          external_id: input.externalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    )
  }

  /** @inheritdoc */
  insertTransferLegs(legs: readonly NewTransferLegInput[]): Promise<Transaction[]> {
    return this.trx
      .insertInto('core.transactions')
      .values(
        legs.map((leg) => ({
          user_id: leg.userId,
          account_id: leg.accountId,
          amount: leg.amount,
          merchant: leg.merchant,
          transaction_date: leg.transactionDate,
          notes: leg.notes,
          transfer_account_id: leg.counterpartAccountId,
          transfer_id: leg.transferId,
        })),
      )
      .returningAll()
      .execute()
  }

  /** @inheritdoc */
  update(id: string, changes: TransactionChanges): Promise<Transaction | undefined> {
    const patch: Updateable<TransactionsTable> = { updated_at: new Date() }
    if (changes.amount !== undefined) patch.amount = changes.amount
    if (changes.merchant !== undefined) patch.merchant = changes.merchant
    if (changes.transactionDate !== undefined) patch.transaction_date = changes.transactionDate
    if (changes.notes !== undefined) patch.notes = changes.notes
    if (changes.categoryId !== undefined) patch.category_id = changes.categoryId
    if (changes.categorySource !== undefined) patch.category_source = changes.categorySource
    return this.trx.updateTable('core.transactions').set(patch).where('id', '=', id).returningAll().executeTakeFirst()
  }

  /** @inheritdoc */
  async setSplitFlag(id: string, isSplit: boolean): Promise<void> {
    await this.trx
      .updateTable('core.transactions')
      .set({ is_split: isSplit, updated_at: new Date() })
      .where('id', '=', id)
      .execute()
  }

  /** @inheritdoc */
  async delete(id: string): Promise<boolean> {
    const gone = await this.trx.deleteFrom('core.transactions').where('id', '=', id).returning('id').executeTakeFirst()
    return gone !== undefined
  }

  /** @inheritdoc */
  async deleteTransferLegs(transferId: string): Promise<number> {
    const gone = await this.trx
      .deleteFrom('core.transactions')
      .where('transfer_id', '=', transferId)
      .returning('id')
      .execute()
    return gone.length
  }

  /** @inheritdoc */
  async findTransferLegIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const legs = await this.trx
      .selectFrom('core.transactions')
      .select('id')
      .where(sql<boolean>`id = ANY(${[...ids]}::uuid[])`)
      .where('transfer_id', 'is not', null)
      .execute()
    return legs.map((leg) => leg.id)
  }

  /** @inheritdoc */
  async assignCategory(ids: readonly string[], categoryId: string, source: CategorySource): Promise<number> {
    if (ids.length === 0) return 0
    const updated = await this.trx
      .updateTable('core.transactions')
      .set({ category_id: categoryId, category_source: source, updated_at: new Date() })
      .where(sql<boolean>`id = ANY(${[...ids]}::uuid[])`)
      .where('transfer_id', 'is', null)
      .returning('id')
      .execute()
    return updated.length
  }

  /** @inheritdoc */
  async clearCategory(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0
    const updated = await this.trx
      .updateTable('core.transactions')
      .set({ category_id: null, category_source: null, updated_at: new Date() })
      .where(sql<boolean>`id = ANY(${[...ids]}::uuid[])`)
      .where('transfer_id', 'is', null)
      .returning('id')
      .execute()
    return updated.length
  }

  /** @inheritdoc */
  findAccounts(ids: readonly string[]): Promise<AccountName[]> {
    if (ids.length === 0) return Promise.resolve([])
    return this.trx.selectFrom('core.accounts').select(['id', 'name']).where('id', 'in', [...ids]).execute()
  }

  /** @inheritdoc */
  async findCategoryIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await this.trx.selectFrom('core.categories').select('id').where('id', 'in', [...ids]).execute()
    return new Set(rows.map((row) => row.id))
  }
}
