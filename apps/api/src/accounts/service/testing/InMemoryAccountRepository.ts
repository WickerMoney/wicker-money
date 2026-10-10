import { Decimal } from 'decimal.js'
import { DuplicateKeyError } from '../../../data/DuplicateKeyError.js'
import type { ReferenceUsage } from '../../../db/usage.js'
import type { AccountBasic } from '../../repository/AccountBasic.js'
import type { AccountChanges } from '../../repository/AccountChanges.js'
import type { AccountLabel } from '../../repository/AccountLabel.js'
import type { AccountRepository } from '../../repository/AccountRepository.js'
import type { AccountWithBalance } from '../../repository/AccountWithBalance.js'
import type { HistoryDeletion } from '../../repository/HistoryDeletion.js'
import type { MigrationAccount } from '../../repository/MigrationAccount.js'
import type { MigrationCounts } from '../../repository/MigrationCounts.js'
import type { NewAccountInput } from '../../repository/NewAccountInput.js'
import type { FakeAccountRow, FakeLedger, FakeLedgerRow } from './FakeLedger.js'

/**
 * An {@link AccountRepository} over plain arrays, scoped to one user the way
 * row-level security scopes the real one: rows owned by anyone else are
 * invisible, not forbidden.
 */
export class InMemoryAccountRepository implements AccountRepository {
  /** Shared across instances: each unit of work builds a fresh repository, and ids must stay unique. */
  private static nextId = 1

  /**
   * @param ledger - The shared in-memory state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly ledger: FakeLedger,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async listWithBalances(includeArchived: boolean): Promise<AccountWithBalance[]> {
    return this.mine()
      .filter((a) => includeArchived || a.archived_at === null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => this.withBalance(a))
  }

  /** @inheritdoc */
  async listBasic(includeArchived: boolean): Promise<AccountBasic[]> {
    return this.mine()
      .filter((a) => includeArchived || a.archived_at === null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        id: a.id, name: a.name, account_type: a.account_type, currency_code: a.currency_code,
        spendable: a.spendable, archived_at: a.archived_at,
      }))
  }

  /** @inheritdoc */
  async findWithBalance(id: string): Promise<AccountWithBalance | undefined> {
    const row = this.mine().find((a) => a.id === id)
    return row === undefined ? undefined : this.withBalance(row)
  }

  /** @inheritdoc */
  async findLabel(id: string): Promise<AccountLabel | undefined> {
    const row = this.mine().find((a) => a.id === id)
    return row === undefined ? undefined : { id: row.id, name: row.name }
  }

  /** @inheritdoc */
  async findMigrationAccounts(ids: readonly string[]): Promise<MigrationAccount[]> {
    return this.mine()
      .filter((a) => ids.includes(a.id))
      .map((a) => ({ id: a.id, name: a.name, currency_code: a.currency_code }))
  }

  /** @inheritdoc */
  async insert(input: NewAccountInput): Promise<AccountWithBalance> {
    const now = new Date(0)
    const row: FakeAccountRow = {
      id: `acct-${InMemoryAccountRepository.nextId++}`,
      userId: input.userId,
      name: input.name,
      account_type: input.accountType,
      initial_balance: input.initialBalance,
      currency_code: input.currencyCode,
      buffer_amount: input.bufferAmount,
      spendable: input.spendable,
      archived_at: null,
      created_at: now,
      updated_at: now,
    }
    this.ledger.accounts.push(row)
    return this.withBalance(row)
  }

  /** @inheritdoc */
  async update(id: string, changes: AccountChanges): Promise<AccountWithBalance | undefined> {
    const row = this.mine().find((a) => a.id === id)
    if (row === undefined) return undefined
    if (changes.name !== undefined) row.name = changes.name
    if (changes.accountType !== undefined) row.account_type = changes.accountType
    if (changes.currencyCode !== undefined) row.currency_code = changes.currencyCode
    if (changes.bufferAmount !== undefined) row.buffer_amount = changes.bufferAmount
    if (changes.spendable !== undefined) row.spendable = changes.spendable
    return this.withBalance(row)
  }

  /** @inheritdoc */
  async archive(id: string): Promise<AccountWithBalance | undefined> {
    const row = this.mine().find((a) => a.id === id && a.archived_at === null)
    if (row === undefined) return undefined
    row.archived_at = new Date(1)
    return this.withBalance(row)
  }

  /** @inheritdoc */
  async setInitialBalance(id: string, initialBalance: string): Promise<AccountWithBalance | undefined> {
    const row = this.mine().find((a) => a.id === id)
    if (row === undefined) return undefined
    row.initial_balance = initialBalance
    return this.withBalance(row)
  }

  /** @inheritdoc */
  async delete(id: string): Promise<boolean> {
    const before = this.ledger.accounts.length
    this.ledger.accounts = this.ledger.accounts.filter((a) => !(a.userId === this.userId && a.id === id))
    return this.ledger.accounts.length < before
  }

  /** @inheritdoc */
  async countMigrationRows(fromId: string, toId: string): Promise<MigrationCounts> {
    const transactions = this.split(this.ledger.transactions, fromId, toId)
    const recurringItems = this.split(this.ledger.recurringItems, fromId, toId)
    return {
      transferTransactions: transactions.between,
      transferRecurringItems: recurringItems.between,
      otherTransactions: transactions.other,
      otherRecurringItems: recurringItems.other,
    }
  }

  /** @inheritdoc */
  async moveHistory(fromId: string, toId: string): Promise<void> {
    const between = (r: FakeLedgerRow): boolean =>
      (r.accountId === fromId && r.transferAccountId === toId) || (r.accountId === toId && r.transferAccountId === fromId)
    this.ledger.transactions = this.ledger.transactions.filter((r) => !(this.owns(r) && between(r)))
    this.ledger.recurringItems = this.ledger.recurringItems.filter((r) => !(this.owns(r) && between(r)))

    const targetExternalIds = new Set(
      this.ledger.transactions.filter((r) => r.accountId === toId && r.externalId !== null).map((r) => r.externalId),
    )
    for (const row of this.ledger.transactions) {
      if (row.accountId === fromId && row.externalId !== null && targetExternalIds.has(row.externalId)) {
        throw new DuplicateKeyError('ux_transactions_account_external_id', undefined)
      }
    }
    for (const row of [...this.ledger.transactions, ...this.ledger.recurringItems]) {
      if (!this.owns(row)) continue
      if (row.accountId === fromId) row.accountId = toId
      if (row.transferAccountId === fromId) row.transferAccountId = toId
    }
  }

  /** @inheritdoc */
  async deleteHistory(id: string): Promise<HistoryDeletion> {
    const touches = (r: FakeLedgerRow): boolean => this.owns(r) && (r.accountId === id || r.transferAccountId === id)
    const transactions = this.ledger.transactions.filter(touches).length
    const recurringItems = this.ledger.recurringItems.filter(touches).length
    this.ledger.transactions = this.ledger.transactions.filter((r) => !touches(r))
    this.ledger.recurringItems = this.ledger.recurringItems.filter((r) => !touches(r))
    return { transactions, recurringItems }
  }

  /**
   * Counts referencing rows per table, as the catalog-driven usage discovery would.
   *
   * @param id - The account id.
   * @returns Usage across transactions and recurring items.
   */
  summarizeUsage(id: string): ReferenceUsage {
    const count = (rows: readonly FakeLedgerRow[]): number =>
      rows.filter((r) => this.owns(r) && (r.accountId === id || r.transferAccountId === id)).length
    const by = [
      { table: 'core.transactions', count: count(this.ledger.transactions) },
      { table: 'core.recurring_items', count: count(this.ledger.recurringItems) },
    ].filter((entry) => entry.count > 0)
    return { total: by.reduce((sum, entry) => sum + entry.count, 0), by, unreadable: [] }
  }

  private mine(): FakeAccountRow[] {
    return this.ledger.accounts.filter((a) => a.userId === this.userId)
  }

  private owns(row: FakeLedgerRow): boolean {
    return row.userId === this.userId
  }

  private withBalance(row: FakeAccountRow): AccountWithBalance {
    const rest: Omit<FakeAccountRow, 'userId'> & { userId?: string } = { ...row }
    delete rest.userId
    const total = this.ledger.transactions
      .filter((t) => this.owns(t) && t.accountId === row.id)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0))
    return { ...rest, balance: new Decimal(row.initial_balance).plus(total).toFixed(4) }
  }

  private split(rows: readonly FakeLedgerRow[], fromId: string, toId: string): { between: number; other: number } {
    let between = 0
    let other = 0
    for (const r of rows) {
      if (!this.owns(r) || (r.accountId !== fromId && r.transferAccountId !== fromId)) continue
      const isBetween =
        (r.accountId === fromId && r.transferAccountId === toId) || (r.accountId === toId && r.transferAccountId === fromId)
      if (isBetween) between++
      else other++
    }
    return { between, other }
  }
}
