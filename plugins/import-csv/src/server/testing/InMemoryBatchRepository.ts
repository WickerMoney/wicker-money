import type { BatchOutcome } from '../repository/BatchOutcome.js'
import type { BatchListRow } from '../repository/BatchListRow.js'
import type { BatchRecord } from '../repository/BatchRecord.js'
import type { BatchRepository } from '../repository/BatchRepository.js'
import { IDEMPOTENCY_KEY_INDEX } from '../repository/IDEMPOTENCY_KEY_INDEX.js'
import type { NewBatch } from '../repository/NewBatch.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'
import type { StoredBatch } from './StoredBatch.js'

/** {@link BatchRepository} over an {@link InMemoryImportStore}, narrowed to one user. */
export class InMemoryBatchRepository implements BatchRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose batches are visible.
   */
  constructor(
    private readonly store: InMemoryImportStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async listRecent(limit: number): Promise<BatchListRow[]> {
    return this.store.batches
      .filter((b) => b.userId === this.userId)
      .map((b) => ({
        id: b.id,
        sourceName: b.sourceName,
        fileName: b.fileName,
        rowsTotal: b.rowsTotal,
        rowsImported: b.rowsImported,
        rowsSkipped: b.rowsSkipped,
        rowsFlagged: b.rowsFlagged,
        createdAt: new Date(0),
        revertedAt: b.revertedAt,
        accountName: b.accountId,
      }))
      .reverse()
      .slice(0, limit)
  }

  /** @inheritdoc */
  async create(batch: NewBatch): Promise<string | undefined> {
    if (batch.idempotencyKey !== undefined && this.keyed(batch.idempotencyKey) !== undefined) {
      // Mirrors the database's unique index, so the service's handling of a
      // lost race can be exercised without one.
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint: IDEMPOTENCY_KEY_INDEX,
      })
    }
    const id = this.store.nextId('batch')
    this.store.callLog.push('createBatch')
    this.store.batches.push({ id, userId: this.userId, revertedAt: null, ...batch })
    return id
  }

  /** @inheritdoc */
  async findByIdempotencyKey(key: string): Promise<BatchOutcome | undefined> {
    const batch = this.keyed(key)
    return batch === undefined
      ? undefined
      : { id: batch.id, rowsImported: batch.rowsImported, rowsSkipped: batch.rowsSkipped, rowsFlagged: batch.rowsFlagged }
  }

  /** @inheritdoc */
  async findById(id: string): Promise<BatchRecord | undefined> {
    const batch = this.store.batches.find((b) => b.id === id && b.userId === this.userId)
    return batch === undefined ? undefined : { id: batch.id, revertedAt: batch.revertedAt }
  }

  /** @inheritdoc */
  async markReverted(id: string): Promise<void> {
    const batch = this.store.batches.find((b) => b.id === id && b.userId === this.userId)
    if (batch !== undefined) batch.revertedAt = new Date()
  }

  private keyed(key: string): StoredBatch | undefined {
    return this.store.batches.find((b) => b.userId === this.userId && b.idempotencyKey === key)
  }
}
