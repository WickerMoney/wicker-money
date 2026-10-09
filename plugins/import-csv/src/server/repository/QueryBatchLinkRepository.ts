import type { BatchLinkRepository } from './BatchLinkRepository.js'
import { INSERT_CHUNK_SIZE } from './INSERT_CHUNK_SIZE.js'
import { chunk } from './chunk.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

/** {@link BatchLinkRepository} over the plugin's query runner. */
export class QueryBatchLinkRepository implements BatchLinkRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async linkMany(batchId: string, transactionIds: readonly string[]): Promise<void> {
    for (const slice of chunk(transactionIds, INSERT_CHUNK_SIZE)) {
      await this.q`
        INSERT INTO plugin_import_csv.batch_transactions (batch_id, transaction_id, user_id)
        SELECT ${batchId}::uuid, t.id, core.current_user_id()
        FROM unnest(${slice}::uuid[]) AS t(id)
      `
    }
  }
}
