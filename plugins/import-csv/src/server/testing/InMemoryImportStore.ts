import type { SavedMappingRow } from '../repository/SavedMappingRow.js'
import type { RuleForMatching } from '../repository/RuleForMatching.js'
import type { StoredBatch } from './StoredBatch.js'
import type { StoredTransaction } from './StoredTransaction.js'

/** The data every in-memory unit of work reads and writes. */
export class InMemoryImportStore {
  /** Account id to owning user id. */
  readonly accounts = new Map<string, string>()
  /** Every ledger row. */
  readonly transactions: StoredTransaction[] = []
  /** Every batch. */
  readonly batches: StoredBatch[] = []
  /** `batchId` to the transaction ids it created. */
  readonly links = new Map<string, string[]>()
  /** Saved mappings, keyed by `userId` and lower-cased source name. */
  readonly mappings = new Map<string, SavedMappingRow>()
  /** The rules handed to the category resolver. */
  rules: RuleForMatching[] = []
  /** `userId:accountId` keys in the order locks were taken. */
  readonly lockLog: string[] = []
  /** Names the repository calls in the order they happened. */
  readonly callLog: string[] = []

  private counter = 0

  /**
   * @param prefix - A short label for the kind of id.
   * @returns A new id that is unique within this store.
   */
  nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}-${String(this.counter).padStart(4, '0')}`
  }
}
