import { randomUUID } from 'node:crypto'
import type { TransactionSplit } from '../../../db/models/index.js'
import type { NewSplitInput } from '../../repository/NewSplitInput.js'
import type { SplitRepository } from '../../repository/SplitRepository.js'
import type { FakeLedger } from './FakeLedger.js'

/** A {@link SplitRepository} over an in-memory ledger; rows of other users are invisible. */
export class InMemorySplitRepository implements SplitRepository {
  /**
   * @param ledger - Shared state.
   * @param userId - The user whose rows are visible.
   */
  constructor(
    private readonly ledger: FakeLedger,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  listForTransaction(transactionId: string): Promise<TransactionSplit[]> {
    return Promise.resolve(
      this.ledger.splits.filter((s) => s.user_id === this.userId && s.transaction_id === transactionId),
    )
  }

  /** @inheritdoc */
  async replaceForTransaction(transactionId: string, splits: readonly NewSplitInput[]): Promise<TransactionSplit[]> {
    await this.deleteForTransaction(transactionId)
    const now = new Date()
    const rows = splits.map(
      (s): TransactionSplit => ({
        id: randomUUID(),
        user_id: s.userId,
        transaction_id: s.transactionId,
        amount: s.amount,
        category_id: s.categoryId,
        notes: s.notes,
        created_at: now,
        updated_at: now,
      }),
    )
    this.ledger.splits.push(...rows)
    return rows
  }

  /** @inheritdoc */
  deleteForTransaction(transactionId: string): Promise<number> {
    const before = this.ledger.splits.length
    this.ledger.splits = this.ledger.splits.filter(
      (s) => !(s.user_id === this.userId && s.transaction_id === transactionId),
    )
    return Promise.resolve(before - this.ledger.splits.length)
  }
}
