import type { ExistingTransaction } from '../../shared/index.js'
import type { LedgerRepository } from '../repository/LedgerRepository.js'
import type { NewLedgerRow } from '../repository/NewLedgerRow.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'

/** {@link LedgerRepository} over an {@link InMemoryImportStore}, narrowed to one user. */
export class InMemoryLedgerRepository implements LedgerRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose transactions are visible.
   */
  constructor(
    private readonly store: InMemoryImportStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async findInWindow(accountId: string, from: string, to: string): Promise<ExistingTransaction[]> {
    return this.store.transactions
      .filter((t) => t.userId === this.userId && t.accountId === accountId && t.date >= from && t.date <= to)
      .map((t) => ({ id: t.id, date: t.date, merchant: t.merchant, amount: t.amount, externalId: t.externalId }))
  }

  /** @inheritdoc */
  async insertImported(accountId: string, rows: readonly NewLedgerRow[]): Promise<string[]> {
    this.store.callLog.push('insertImported')
    const ids: string[] = []
    for (const row of rows) {
      const taken =
        row.externalId !== null &&
        this.store.transactions.some((t) => t.accountId === accountId && t.externalId === row.externalId)
      if (taken) continue
      const id = this.store.nextId('txn')
      this.store.transactions.push({
        id, userId: this.userId, accountId, amount: row.amount, merchant: row.merchant, date: row.date,
        externalId: row.externalId, categoryId: row.categoryId, touched: false,
      })
      ids.push(id)
    }
    return ids
  }

  /** @inheritdoc */
  async deleteUntouchedInBatch(batchId: string): Promise<number> {
    const linked = new Set(this.store.links.get(batchId) ?? [])
    let removed = 0
    for (let i = this.store.transactions.length - 1; i >= 0; i -= 1) {
      const t = this.store.transactions[i]!
      if (t.userId === this.userId && linked.has(t.id) && !t.touched) {
        this.store.transactions.splice(i, 1)
        removed += 1
      }
    }
    return removed
  }

  /** @inheritdoc */
  async countInBatch(batchId: string): Promise<number> {
    const linked = new Set(this.store.links.get(batchId) ?? [])
    return this.store.transactions.filter((t) => t.userId === this.userId && linked.has(t.id)).length
  }
}
