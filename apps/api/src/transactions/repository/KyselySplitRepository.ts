import type { TransactionSplit } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import type { NewSplitInput } from './NewSplitInput.js'
import type { SplitRepository } from './SplitRepository.js'

/** Kysely implementation of {@link SplitRepository} over a single transaction. */
export class KyselySplitRepository implements SplitRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  listForTransaction(transactionId: string): Promise<TransactionSplit[]> {
    return this.trx
      .selectFrom('core.transaction_splits')
      .selectAll()
      .where('transaction_id', '=', transactionId)
      .execute()
  }

  /** @inheritdoc */
  async replaceForTransaction(transactionId: string, splits: readonly NewSplitInput[]): Promise<TransactionSplit[]> {
    await this.deleteForTransaction(transactionId)
    return this.trx
      .insertInto('core.transaction_splits')
      .values(
        splits.map((s) => ({
          user_id: s.userId,
          transaction_id: s.transactionId,
          amount: s.amount,
          category_id: s.categoryId,
          notes: s.notes,
        })),
      )
      .returningAll()
      .execute()
  }

  /** @inheritdoc */
  async deleteForTransaction(transactionId: string): Promise<number> {
    const gone = await this.trx
      .deleteFrom('core.transaction_splits')
      .where('transaction_id', '=', transactionId)
      .returning('id')
      .execute()
    return gone.length
  }
}
