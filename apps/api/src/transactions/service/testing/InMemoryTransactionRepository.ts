import { randomUUID } from 'node:crypto'
import { money } from '../../../money.js'
import { DuplicateKeyError } from '../../../data/DuplicateKeyError.js'
import type { CategorySource, Transaction } from '../../../db/models/index.js'
import type { AccountName } from '../../repository/AccountName.js'
import type { NewTransactionInput } from '../../repository/NewTransactionInput.js'
import type { NewTransferLegInput } from '../../repository/NewTransferLegInput.js'
import type { TransactionChanges } from '../../repository/TransactionChanges.js'
import type { TransactionFilterCriteria } from '../../repository/TransactionFilterCriteria.js'
import type { TransactionListCriteria } from '../../repository/TransactionListCriteria.js'
import type { TransactionPage } from '../../repository/TransactionPage.js'
import type { TransactionPosition } from '../../repository/TransactionPosition.js'
import type { TransactionRepository } from '../../repository/TransactionRepository.js'
import type { FakeLedger } from './FakeLedger.js'
import { compareText } from './compareText.js'

/**
 * A {@link TransactionRepository} over an in-memory ledger.
 *
 * Rows of other users are invisible, as row-level security makes them in the
 * database. `lockLog` records every lock request in order so tests can assert
 * the lock discipline.
 */
export class InMemoryTransactionRepository implements TransactionRepository {
  /** Ids passed to a lock call, in call order. */
  readonly lockLog: string[] = []

  /**
   * @param ledger - Shared state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly ledger: FakeLedger,
    private readonly userId: string,
  ) {}

  private visible(): Transaction[] {
    return this.ledger.transactions.filter((t) => t.user_id === this.userId)
  }

  /** @inheritdoc */
  listPage(criteria: TransactionListCriteria): Promise<TransactionPage> {
    const sign = criteria.direction === 'desc' ? -1 : 1
    const ordered = this.matching(criteria).sort((a, b) => sign * this.compare(criteria.sort, a, b))
    const { after } = criteria
    const remaining =
      after === undefined
        ? ordered
        : ordered.filter((row) => sign * this.compareToPosition(criteria.sort, row, after) > 0)
    return Promise.resolve({ items: remaining.slice(0, criteria.limit), hasMore: remaining.length > criteria.limit })
  }

  /** @inheritdoc */
  countMatching(criteria: TransactionFilterCriteria): Promise<number> {
    return Promise.resolve(this.matching(criteria).length)
  }

  private matching(criteria: TransactionFilterCriteria): Transaction[] {
    const categoryIds = new Set(
      criteria.categoryId === undefined
        ? []
        : [
            criteria.categoryId,
            ...this.ledger.categories.filter((c) => c.parentId === criteria.categoryId).map((c) => c.id),
          ],
    )
    const search = criteria.search?.toLowerCase()
    return this.visible().filter(
      (t) =>
        (criteria.accountId === undefined || t.account_id === criteria.accountId) &&
        (criteria.uncategorizedOnly !== true || t.category_id === null) &&
        (criteria.categoryId === undefined || (t.category_id !== null && categoryIds.has(t.category_id))) &&
        (criteria.from === undefined || t.transaction_date >= criteria.from) &&
        (criteria.to === undefined || t.transaction_date <= criteria.to) &&
        (search === undefined || t.merchant.toLowerCase().includes(search)),
    )
  }

  // Ids are compared as plain strings, as the database compares uuids.
  private compare(sort: TransactionListCriteria['sort'], a: Transaction, b: Transaction): number {
    return this.compareToPosition(sort, a, { value: this.valueOf(sort, b), id: b.id })
  }

  private compareToPosition(
    sort: TransactionListCriteria['sort'],
    row: Transaction,
    position: TransactionPosition,
  ): number {
    const value = this.valueOf(sort, row)
    const byValue = sort === 'amount' ? money(value).cmp(position.value) : compareText(value, position.value)
    return byValue !== 0 ? byValue : compareText(row.id, position.id)
  }

  private valueOf(sort: TransactionListCriteria['sort'], row: Transaction): string {
    return { date: row.transaction_date, amount: row.amount, merchant: row.merchant }[sort]
  }

  /** @inheritdoc */
  findById(id: string): Promise<Transaction | undefined> {
    return Promise.resolve(this.visible().find((t) => t.id === id))
  }

  /** @inheritdoc */
  lockById(id: string): Promise<Transaction | undefined> {
    this.lockLog.push(id)
    return this.findById(id)
  }

  /** @inheritdoc */
  lockTransferLegs(transferId: string): Promise<Transaction[]> {
    const legs = this.visible()
      .filter((t) => t.transfer_id === transferId)
      .sort((a, b) => a.id.localeCompare(b.id))
    this.lockLog.push(...legs.map((l) => l.id))
    return Promise.resolve(legs)
  }

  /** @inheritdoc */
  insert(input: NewTransactionInput): Promise<Transaction> {
    const clash =
      input.externalId !== null &&
      this.ledger.transactions.some((t) => t.account_id === input.accountId && t.external_id === input.externalId)
    if (clash) return Promise.reject(new DuplicateKeyError('transactions_external_id', undefined))
    const row = this.build({
      userId: input.userId,
      accountId: input.accountId,
      amount: input.amount,
      merchant: input.merchant,
      transactionDate: input.transactionDate,
      notes: input.notes,
    })
    row.category_id = input.categoryId
    row.category_source = input.categorySource
    row.external_id = input.externalId
    this.ledger.transactions.push(row)
    return Promise.resolve(row)
  }

  /** @inheritdoc */
  insertTransferLegs(legs: readonly NewTransferLegInput[]): Promise<Transaction[]> {
    // One statement in Postgres: either leg clashing writes neither.
    const clash = legs.some(
      (leg) =>
        leg.externalId !== null &&
        this.ledger.transactions.some((t) => t.account_id === leg.accountId && t.external_id === leg.externalId),
    )
    if (clash) return Promise.reject(new DuplicateKeyError('transactions_external_id', undefined))
    const rows = legs.map((leg) => {
      const row = this.build(leg)
      row.transfer_account_id = leg.counterpartAccountId
      row.transfer_id = leg.transferId
      row.external_id = leg.externalId
      return row
    })
    this.ledger.transactions.push(...rows)
    return Promise.resolve(rows)
  }

  /** @inheritdoc */
  update(id: string, changes: TransactionChanges): Promise<Transaction | undefined> {
    const row = this.visible().find((t) => t.id === id)
    if (row === undefined) return Promise.resolve(undefined)
    if (changes.amount !== undefined) row.amount = changes.amount
    if (changes.merchant !== undefined) row.merchant = changes.merchant
    if (changes.transactionDate !== undefined) row.transaction_date = changes.transactionDate
    if (changes.notes !== undefined) row.notes = changes.notes
    if (changes.categoryId !== undefined) row.category_id = changes.categoryId
    if (changes.categorySource !== undefined) row.category_source = changes.categorySource
    return Promise.resolve(row)
  }

  /** @inheritdoc */
  setSplitFlag(id: string, isSplit: boolean): Promise<void> {
    const row = this.visible().find((t) => t.id === id)
    if (row !== undefined) row.is_split = isSplit
    return Promise.resolve()
  }

  /** @inheritdoc */
  delete(id: string): Promise<boolean> {
    const before = this.ledger.transactions.length
    this.ledger.transactions = this.ledger.transactions.filter((t) => !(t.user_id === this.userId && t.id === id))
    this.ledger.splits = this.ledger.splits.filter((s) => s.transaction_id !== id)
    return Promise.resolve(this.ledger.transactions.length < before)
  }

  /** @inheritdoc */
  deleteTransferLegs(transferId: string): Promise<number> {
    const before = this.ledger.transactions.length
    this.ledger.transactions = this.ledger.transactions.filter(
      (t) => !(t.user_id === this.userId && t.transfer_id === transferId),
    )
    return Promise.resolve(before - this.ledger.transactions.length)
  }

  /** @inheritdoc */
  findTransferLegIds(ids: readonly string[]): Promise<string[]> {
    return Promise.resolve(
      this.visible()
        .filter((t) => ids.includes(t.id) && t.transfer_id !== null)
        .map((t) => t.id),
    )
  }

  /** @inheritdoc */
  assignCategory(ids: readonly string[], categoryId: string, source: CategorySource): Promise<number> {
    const rows = this.visible().filter((t) => ids.includes(t.id) && t.transfer_id === null)
    for (const row of rows) {
      row.category_id = categoryId
      row.category_source = source
    }
    return Promise.resolve(rows.length)
  }

  /** @inheritdoc */
  clearCategory(ids: readonly string[]): Promise<number> {
    const rows = this.visible().filter((t) => ids.includes(t.id) && t.transfer_id === null)
    for (const row of rows) {
      row.category_id = null
      row.category_source = null
    }
    return Promise.resolve(rows.length)
  }

  /** @inheritdoc */
  findAccounts(ids: readonly string[]): Promise<AccountName[]> {
    return Promise.resolve(
      this.ledger.accounts
        .filter((a) => a.userId === this.userId && ids.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name })),
    )
  }

  /** @inheritdoc */
  findCategoryIds(ids: readonly string[]): Promise<Set<string>> {
    return Promise.resolve(
      new Set(this.ledger.categories.filter((c) => c.userId === this.userId && ids.includes(c.id)).map((c) => c.id)),
    )
  }

  private build(input: {
    readonly userId: string
    readonly accountId: string
    readonly amount: string
    readonly merchant: string
    readonly transactionDate: string
    readonly notes: string | null
  }): Transaction {
    const now = new Date()
    return {
      id: randomUUID(),
      user_id: input.userId,
      account_id: input.accountId,
      amount: input.amount,
      merchant: input.merchant,
      category_id: null,
      category_source: null,
      transaction_date: input.transactionDate,
      notes: input.notes,
      external_id: null,
      transfer_account_id: null,
      transfer_id: null,
      is_split: false,
      created_at: now,
      updated_at: now,
    }
  }
}
